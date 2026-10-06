"""Local CPU semantic pilot; ranking fixtures are not a KPI accuracy benchmark.

Runs candidates in separate processes and retains raw timings, token coverage,
memory and revisions. No model/default or KPI threshold is changed.
"""
import argparse
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/nlp-model-study'

# Independent positive/negative descriptions, including misleading vocabulary.
CASES = [
    ('fr', 'Comment exercer votre droit à l’effacement des données',
     'Vous pouvez demander la suppression de vos informations personnelles. Adressez votre demande à notre délégué à la protection des données.',
     'Notre entreprise supprime les fichiers temporaires de ses serveurs chaque nuit afin de réduire la consommation de disque.'),
    ('fr', 'Tarifs des abonnements et modalités de paiement',
     'Le forfait mensuel coûte vingt euros. Vous pouvez régler votre abonnement par carte et annuler le renouvellement depuis votre compte.',
     'Ce guide explique comment mesurer la vitesse du réseau et réparer une connexion interrompue.'),
    ('fr', 'Accessibilité pour les personnes malvoyantes',
     'Notre service prend en charge les lecteurs d’écran et la navigation au clavier. Le contraste et les descriptions des images facilitent la lecture.',
     'Nos écrans sont disponibles à la vente. Ce catalogue présente les prix et les tailles des moniteurs.'),
    ('fr', 'Conseils pour économiser l’énergie à la maison',
     'Réglez votre chauffage, isolez les fenêtres et éteignez les appareils inutilisés pour réduire votre facture d’électricité.',
     'Cette page décrit les conditions de remboursement d’une commande et les délais de livraison.'),
    ('en', 'Request deletion of your personal information',
     'You can ask us to erase the details held about you. Contact our privacy officer to exercise this right.',
     'We delete temporary database files every night to maintain server performance.'),
    ('en', 'Account subscription prices and billing',
     'Our monthly plan costs twenty dollars. Pay by card and cancel recurring payments from your account settings.',
     'We explain how to speed up a slow network and reconnect a disconnected router.'),
    ('en', 'Support for people using assistive technology',
     'Screen reader compatibility, keyboard navigation and descriptive image labels make the service accessible.',
     'Browse screens for sale in our electronics catalogue, with specifications and delivery prices.'),
    ('en', 'Saving energy in your home',
     'Insulate windows, adjust heating and turn off unused appliances to reduce electricity consumption.',
     'Read our policy for returning purchases and obtaining a refund.'),
    ('ar', 'طلب حذف البيانات الشخصية',
     'يمكنك طلب إزالة المعلومات التي نحتفظ بها عنك. تواصل مع مسؤول حماية البيانات لممارسة هذا الحق.',
     'نحذف الملفات المؤقتة من الخادم كل ليلة لتحسين أداء النظام.'),
    ('ar', 'أسعار الاشتراك وطرق الدفع',
     'تبلغ تكلفة الباقة الشهرية عشرين دينارا. يمكنك الدفع بالبطاقة وإلغاء التجديد من إعدادات حسابك.',
     'يوضح هذا الدليل كيفية إصلاح انقطاع الإنترنت وتحسين سرعة الشبكة.'),
    ('ar', 'إمكانية الوصول للمستخدمين ذوي الإعاقة البصرية',
     'يدعم الموقع قارئات الشاشة والتنقل بلوحة المفاتيح مع أوصاف للصور وتباين مناسب للنصوص.',
     'يعرض متجرنا شاشات للبيع مع تفاصيل الأحجام والأسعار وخيارات التوصيل.'),
    ('ar', 'تقليل استهلاك الطاقة في المنزل',
     'يساعد عزل النوافذ وضبط التدفئة وإطفاء الأجهزة غير المستخدمة على خفض فاتورة الكهرباء.',
     'توضح هذه الصفحة شروط إرجاع المشتريات واسترداد الأموال.'),
]


def worker(args):
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TOKENIZERS_PARALLELISM='false')
    import numpy as np
    import psutil
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    process = psutil.Process()
    peak = [process.memory_info().rss]
    stop = threading.Event()

    def sample():
        while not stop.wait(.05):
            peak[0] = max(peak[0], process.memory_info().rss)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    lock = json.loads((OUT / 'models.lock.json').read_text())[args.index]
    started = time.perf_counter()
    model = SentenceTransformer(lock['path'], device='cpu', local_files_only=True)
    parameters = sum(p.numel() for p in model.parameters())
    if args.mode == 'int8':
        # CPU-only pilot: dynamically quantize Linear layers, leaving embeddings
        # and normalization in float. Separate process includes conversion cost.
        model[0].auto_model = torch.ao.quantization.quantize_dynamic(
            model[0].auto_model, {torch.nn.Linear}, dtype=torch.qint8)
    load_seconds = time.perf_counter() - started
    e5 = 'multilingual-e5' in lock['model']

    def encode(texts, kinds=None):
        if e5:
            texts = [('query: ' if kind == 'heading' else 'passage: ') + text
                     for text, kind in zip(texts, kinds or ['body'] * len(texts))]
        return model.encode(texts, convert_to_numpy=True, normalize_embeddings=True,
                            show_progress_bar=False, batch_size=8)

    rankings = []
    for lang, heading, positive, negative in CASES:
        vectors = encode([heading, positive, negative], ['heading', 'body', 'body'])
        a, b = float(vectors[0] @ vectors[1]), float(vectors[0] @ vectors[2])
        rankings.append(dict(language=lang, heading=heading, positive=a, negative=b,
                             correct=a > b, margin=a-b))

    # Production truncation is 6000 characters; the tokenizer can discard most
    # of those characters. Capture token lengths rather than treating them as read.
    pages = []
    for lang, heading, positive, _ in CASES:
        body = (' '.join([positive] * 35))[:6000]
        pages.append([heading, body, positive[:145], heading + ' – informations'])
    coverage = []
    for texts in pages:
        raw = model.tokenizer(texts[1], truncation=False, add_special_tokens=True)['input_ids']
        coverage.append(dict(tokens=len(raw), limit=model.max_seq_length,
                             tokens_retained=min(len(raw), model.max_seq_length)))

    def batched(texts):
        vectors = encode(texts, ['heading', 'body', 'heading', 'heading'])
        return [float(vectors[i] @ vectors[1]) for i in [0, 2, 3]]

    def original(texts):
        return [float(np.dot(*encode([texts[i], texts[1]], ['heading', 'body'])))
                for i in [0, 2, 3]]

    for texts in pages[:2]:
        batched(texts)
    timings, old_timings = [], []
    max_delta = 0.
    for _ in range(args.repeats):
        for texts in pages:
            started = time.perf_counter()
            optimized = batched(texts)
            timings.append((time.perf_counter()-started)*1000)
            started = time.perf_counter()
            old = original(texts)
            old_timings.append((time.perf_counter()-started)*1000)
            max_delta = max(max_delta, max(abs(a-b) for a,b in zip(old, optimized)))
    stop.set()
    sampler.join()
    row = dict(model=lock['model'], revision=lock['revision'], mode=args.mode,
               threads=args.threads, parameters=parameters, load_seconds=load_seconds,
               peak_rss_mib=peak[0]/1024**2, steady_rss_mib=process.memory_info().rss/1024**2,
               batch_ms=timings, original_ms=old_timings,
               batch_p50_ms=statistics.median(timings), batch_p95_ms=float(np.percentile(timings,95)),
               original_p50_ms=statistics.median(old_timings), max_batch_cosine_delta=max_delta,
               ranking_correct=sum(r['correct'] for r in rankings), ranking_total=len(rankings),
               rankings=rankings, token_coverage=coverage,
               runtime=dict(python=sys.version, torch=torch.__version__,
                            sentence_transformers=__import__('sentence_transformers').__version__),
               limitations='Synthetic relevance ordering; no production KPI correctness claim. CPU host pilot, not container acceptance.')
    output = OUT / f'model-{args.index}-{args.mode}.json'
    output.write_text(json.dumps(row,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:row[k] for k in ['model','mode','batch_p50_ms','original_p50_ms','ranking_correct','peak_rss_mib']},ensure_ascii=False),flush=True)


def main(args):
    if args.index is not None:
        worker(args)
        return
    lock = json.loads((OUT/'models.lock.json').read_text())
    for index in range(len(lock)):
        for mode in ['float32','int8']:
            subprocess.run([sys.executable,__file__,'--index',str(index),'--mode',mode,
                            '--threads',str(args.threads),'--repeats',str(args.repeats)],check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--index',type=int)
    parser.add_argument('--mode',choices=['float32','int8'],default='float32')
    parser.add_argument('--threads',type=int,default=2)
    parser.add_argument('--repeats',type=int,default=3)
    main(parser.parse_args())
