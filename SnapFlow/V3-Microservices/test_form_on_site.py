#!/usr/bin/env python3
"""
Form Fuzzer Test Runner - Tests forms on real websites
Detects form anomalies: validation, security, and functionality issues
"""

import sys
import requests
import json
import time
import os
import argparse
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import re

try:
    import cloudscraper  # Optional: used for Cloudflare-aware session handling
except Exception:
    cloudscraper = None

# Configuration
TARGET_URL = "https://www.sogepatn.com/Fr/nous-contacter_10_8"
TIMEOUT = 30
MAX_RETRIES = 3


def build_default_headers(user_agent=None):
    return {
        'User-Agent': user_agent or 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }


def create_session(use_cloudscraper=True, cf_clearance=None, user_agent=None):
    """Create HTTP session with optional Cloudflare-aware behavior."""
    session = None

    if use_cloudscraper and cloudscraper is not None:
        try:
            session = cloudscraper.create_scraper(
                browser={"browser": "chrome", "platform": "windows", "desktop": True}
            )
            print("✓ Using cloudscraper session")
        except Exception as e:
            print(f"⚠️  cloudscraper init failed, falling back to requests: {e}")

    if session is None:
        session = requests.Session()
        print("✓ Using requests session")

    session.headers.update(build_default_headers(user_agent=user_agent))

    # Special config mode: user-provided Cloudflare clearance cookie
    if cf_clearance:
        session.cookies.set('cf_clearance', cf_clearance, domain='.sogepatn.com')
        print("✓ Applied cf_clearance cookie")

    return session


def is_cloudflare_challenge(response_text, response_url=""):
    text = (response_text or "").lower()
    return (
        'one moment, please' in text
        or 'cf-challenge' in text
        or '/cdn-cgi/challenge-platform/' in text
        or 'attention required!' in text
        or 'cloudflare' in text and 'challenge' in text
        or '/cdn-cgi/' in (response_url or "").lower()
    )

def fetch_page(session, url):
    """Fetch page and return BeautifulSoup object"""
    print(f"📥 Fetching {url}...")
    try:
        resp = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        resp.raise_for_status()

        if is_cloudflare_challenge(resp.text, resp.url):
            print("⚠️  Cloudflare challenge detected (content gate active)")

        return BeautifulSoup(resp.content, 'html.parser'), resp
    except Exception as e:
        print(f"❌ Error fetching page: {e}")
        return None, None

def discover_forms(soup, base_url):
    """Discover all forms on the page"""
    forms = []
    form_tags = soup.find_all('form')
    
    if not form_tags:
        print("⚠️  No forms found on page")
        return forms
    
    print(f"✓ Found {len(form_tags)} form(s)")
    
    for idx, form in enumerate(form_tags):
        form_id = form.get('id', f'form_{idx}')
        form_name = form.get('name', form_id)
        action = form.get('action', '')
        method = form.get('method', 'POST').upper()
        
        # Resolve relative URLs
        if action and not action.startswith('http'):
            action = urljoin(base_url, action)
        elif not action:
            action = base_url
        
        # Find all fields
        fields = []
        csrf_token = None
        csrf_field_name = None
        
        for field in form.find_all(['input', 'textarea', 'select']):
            field_name = field.get('name', '')
            if not field_name:
                continue
                
            field_type = field.get('type', 'text').lower()
            if field.name == 'textarea':
                field_type = 'textarea'
            elif field.name == 'select':
                field_type = 'select'
            
            required = field.has_attr('required')
            
            # Capture CSRF tokens
            if 'csrf' in field_name.lower() and field_type == 'hidden':
                csrf_field_name = field_name
                csrf_token = field.get('value', '')
                print(f"  ✓ Found CSRF token field: {field_name}")
            
            fields.append({
                'name': field_name,
                'type': field_type,
                'required': required,
                'field_tag': field.name,
                'value': field.get('value', '')
            })
        
        forms.append({
            'form_id': form_id,
            'form_name': form_name,
            'action': action,
            'method': method,
            'fields': fields,
            'page_url': base_url,
            'csrf_token': csrf_token,
            'csrf_field_name': csrf_field_name
        })
    
    return forms

def test_form(session, form_data, test_type='basic'):
    """Test form with fuzzing"""
    results = {
        'form_id': form_data['form_id'],
        'page_url': form_data['page_url'],
        'action_url': form_data['action'],
        'method': form_data['method'],
        'test_type': test_type,
        'tests_run': 0,
        'anomalies': [],
    }
    
    # Generate test payloads based on field types
    test_payloads = generate_payloads(
        form_data['fields'], 
        test_type,
        csrf_token=form_data.get('csrf_token'),
        csrf_field_name=form_data.get('csrf_field_name')
    )
    
    headers = {
        'Referer': form_data['page_url'],
    }
    
    for payload_type, payload in test_payloads:
        results['tests_run'] += 1
        try:
            start = time.time()
            
            if form_data['method'] == 'POST':
                resp = session.post(
                    form_data['action'],
                    data=payload,
                    timeout=TIMEOUT,
                    allow_redirects=True,
                    headers=headers
                )
            else:
                resp = session.get(
                    form_data['action'],
                    params=payload,
                    timeout=TIMEOUT,
                    allow_redirects=True,
                    headers=headers
                )
            
            duration_ms = (time.time() - start) * 1000
            
            # Check for anomalies
            anomalies = check_response_anomalies(resp, form_data, payload_type)
            
            test_result = {
                'payload_type': payload_type,
                'status_code': resp.status_code,
                'duration_ms': duration_ms,
                'anomalies_found': len(anomalies) > 0,
                'anomalies': anomalies
            }
            
            if anomalies:
                results['anomalies'].extend(anomalies)
            
            print(f"  ✓ {payload_type}: {resp.status_code} ({duration_ms:.0f}ms)")
            if anomalies:
                for anom in anomalies:
                    print(f"    ⚠️  ANOMALY: {anom['reason']}")
        
        except Exception as e:
            print(f"  ❌ {payload_type}: {str(e)}")
            results['anomalies'].append({
                'type': 'error',
                'reason': str(e),
                'payload_type': payload_type
            })
    
    return results

def generate_payloads(fields, test_type, csrf_token=None, csrf_field_name=None):
    """Generate test payloads for form fields"""
    payloads = []
    
    # Build basic payload
    basic_payload = {}
    for field in fields:
        # Include hidden field values if they exist
        if field['type'] == 'hidden':
            basic_payload[field['name']] = field.get('value', '')
        elif field['type'] in ['text', 'email', 'tel', 'url', 'password']:
            basic_payload[field['name']] = f"test_{field['name']}"
        elif field['type'] == 'textarea':
            basic_payload[field['name']] = "Test message content"
        elif field['type'] == 'checkbox':
            basic_payload[field['name']] = 'on'
        elif field['type'] == 'radio':
            basic_payload[field['name']] = 'option1'
        elif field['type'] == 'select':
            basic_payload[field['name']] = 'option1'
        elif field['type'] == 'number':
            basic_payload[field['name']] = '123'
        elif field['type'] == 'date':
            basic_payload[field['name']] = '2025-01-15'
    
    payloads.append(('basic_valid_input', basic_payload))
    
    if test_type == 'fuzzing':
        # Empty payload (test required fields)
        payloads.append(('empty_fields', {f['name']: '' for f in fields}))
        
        # XSS test
        xss_payload = dict(basic_payload)
        for field in fields:
            if field['type'] in ['text', 'textarea', 'email']:
                xss_payload[field['name']] = '<script>alert("xss")</script>'
        payloads.append(('xss_injection', xss_payload))
        
        # SQL injection test
        sqli_payload = dict(basic_payload)
        for field in fields:
            if field['type'] in ['text', 'email']:
                sqli_payload[field['name']] = "' OR '1'='1"
        payloads.append(('sqli_injection', sqli_payload))
    
    return payloads

def check_response_anomalies(response, form_data, payload_type):
    """Check response for anomalies"""
    anomalies = []
    
    # Check for forbidden (403) - form can't be submitted
    if response.status_code == 403:
        anomalies.append({
            'type': 'forbidden',
            'reason': f'Form submission blocked with 403 Forbidden (possible CSRF token issue or server-side blocking)',
            'severity': 'high',
            'status_code': 403
        })
    
    # Check for unexpected redirects
    elif response.status_code in [301, 302, 303, 307, 308]:
        anomalies.append({
            'type': 'redirect',
            'reason': f'Unexpected redirect to {response.status_code}',
            'severity': 'medium'
        })
    
    # Check for server errors
    elif response.status_code >= 500:
        anomalies.append({
            'type': 'server_error',
            'reason': f'Server error {response.status_code}',
            'severity': 'high'
        })
    
    # Check for suspicious patterns
    content = response.text.lower()
    
    # Error patterns that might indicate issues
    error_patterns = [
        ('exception', 'Unhandled exception in form processing'),
        ('error 500', 'Server encountered error'),
        ('undefined', 'JavaScript undefined variable'),
        ('fatal error', 'PHP fatal error'),
        ('sql syntax', 'SQL syntax error (possible SQLi)',  ),
        ('parse error', 'JSON/XML parse error'),
    ]
    
    for pattern, msg in error_patterns:
        if pattern in content:
            anomalies.append({
                'type': 'error_pattern',
                'reason': msg,
                'severity': 'high' if 'sql' in pattern else 'medium'
            })
    
    # Check for required field handling with empty payload
    if payload_type == 'empty_fields':
        required_fields = [f for f in form_data['fields'] if f['required']]
        if required_fields and response.status_code == 200:
            anomalies.append({
                'type': 'missing_validation',
                'reason': f'Form accepted empty submission but has {len(required_fields)} required fields',
                'severity': 'high'
            })
    
    # Check for XSS reflected in response
    elif payload_type == 'xss_injection':
        if '<script>alert' in response.text:
            anomalies.append({
                'type': 'xss_vulnerability',
                'reason': 'XSS payload reflected in response',
                'severity': 'critical'
            })
    
    return anomalies


def parse_args():
    parser = argparse.ArgumentParser(description="Form fuzzer with optional Cloudflare special config")
    parser.add_argument("--url", default=os.getenv("TARGET_URL", TARGET_URL), help="Target page URL")
    parser.add_argument("--cf-clearance", default=os.getenv("CF_CLEARANCE"), help="Cloudflare cf_clearance cookie value")
    parser.add_argument("--cf-user-agent", default=os.getenv("CF_USER_AGENT"), help="User-Agent used when cf_clearance was generated")
    parser.add_argument("--no-cloudscraper", action="store_true", help="Disable cloudscraper and use plain requests")
    return parser.parse_args()

def main():
    args = parse_args()

    print("\n" + "="*80)
    print("FORM FUZZER TEST - Website Form Analysis")
    print("="*80)
    print(f"Target: {args.url}\n")

    session = create_session(
        use_cloudscraper=not args.no_cloudscraper,
        cf_clearance=args.cf_clearance,
        user_agent=args.cf_user_agent,
    )
    
    # Fetch page
    soup, resp = fetch_page(session, args.url)
    if not soup:
        print("❌ Failed to fetch target page")
        sys.exit(1)

    if is_cloudflare_challenge(resp.text, resp.url):
        print("\n❌ Cloudflare challenge still active.")
        print("   Special config required:")
        print("   1) Open target page in a real browser and pass challenge")
        print("   2) Export cf_clearance cookie")
        print("   3) Re-run with:")
        print("      CF_CLEARANCE='<value>' CF_USER_AGENT='<same browser UA>' python3 V3-Microservices/test_form_on_site.py --url '<target_url>'")
        sys.exit(2)
    
    # Discover forms
    forms = discover_forms(soup, args.url)
    if not forms:
        print("❌ No forms discovered")
        sys.exit(1)
    
    print(f"\n✓ Discovered {len(forms)} form(s)\n")
    
    # Test each form
    all_results = []
    total_anomalies = 0
    
    for form_idx, form_data in enumerate(forms, 1):
        print(f"{'─'*80}")
        print(f"Form {form_idx}: {form_data['form_name']}")
        print(f"{'─'*80}")
        print(f"  Action: {form_data['action']}")
        print(f"  Method: {form_data['method']}")
        print(f"  Fields: {len(form_data['fields'])}")
        for field in form_data['fields']:
            required_indicator = "✱" if field['required'] else " "
            print(f"    {required_indicator} {field['name']} ({field['type']})")
        
        print(f"\n  Testing forms...")
        results = test_form(session, form_data, test_type='fuzzing')
        all_results.append(results)
        
        anomaly_count = len(results['anomalies'])
        total_anomalies += anomaly_count
        
        print(f"\n  📊 Results:")
        print(f"    Tests Run: {results['tests_run']}")
        print(f"    Anomalies: {anomaly_count}")
        
        if results['anomalies']:
            print(f"\n  🔴 ISSUES FOUND:")
            for anom in results['anomalies']:
                severity = anom.get('severity', 'medium').upper()
                print(f"    [{severity}] {anom['reason']}")
        else:
            print(f"\n  ✓ No anomalies detected")
        print()
    
    # Summary report
    print("="*80)
    print("FORM FUZZER REPORT SUMMARY")
    print("="*80)
    print(f"Total Forms Tested: {len(forms)}")
    print(f"Total Tests Run: {sum(r['tests_run'] for r in all_results)}")
    print(f"Total Anomalies Found: {total_anomalies}")
    
    if total_anomalies > 0:
        print(f"\n🔴 FORM ISSUES DETECTED - Action Required!")
        for form_result in all_results:
            if form_result['anomalies']:
                print(f"\n  Form: {form_result['form_id']}")
                for anom in form_result['anomalies']:
                    print(f"    • {anom['reason']}")
    else:
        print(f"\n✓ All forms passed testing")
    
    print("\n" + "="*80)
    
    # Export JSON
    output_file = "/workspaces/Snapflow-Privatework/form_test_results.json"
    with open(output_file, 'w') as f:
        json.dump({
            'url': args.url,
            'timestamp': time.time(),
            'forms_tested': len(forms),
            'total_anomalies': total_anomalies,
            'results': all_results
        }, f, indent=2)
    
    print(f"✓ Results exported to: {output_file}\n")
    
    return 0 if total_anomalies == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
