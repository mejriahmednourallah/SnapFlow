package security

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnsupportedHeadMeasuresResourceWithGET(t *testing.T) {
	for _, headStatus := range []int{http.StatusMethodNotAllowed, http.StatusNotImplemented} {
		t.Run(fmt.Sprint(headStatus), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					w.WriteHeader(headStatus)
					return
				}
				switch r.URL.Path {
				case "/admin", "/.env":
					fmt.Fprint(w, "Administrative dashboard: DB_PASSWORD=secret")
				case "/broken":
					w.WriteHeader(http.StatusInternalServerError)
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			probe := probeWordlistPaths(server.URL, []string{"/admin", "/absent", "/broken"})
			if len(probe.Exposed) != 1 || probe.Exposed[0] != "/admin" || probe.StatusCodes["/absent"] != 404 || len(probe.ServerErrors) != 1 || probe.ServerErrors[0] != "/broken" {
				t.Fatalf("GET observations must determine classification: %+v", probe)
			}
			admin := checkAdminSensitivePages(server.URL, "")
			if len(admin.Exposed) != 1 || admin.Exposed[0] != "/admin" || len(admin.ServerErrors) != 0 {
				t.Fatalf("unsupported HEAD must not obscure actual admin exposure: %+v", admin)
			}
			files := checkSensitiveFileExposure(server.URL)
			if len(files.Exposed) != 1 || files.Exposed[0] != "/.env" || len(files.ServerErrors) != 0 {
				t.Fatalf("unsupported HEAD must not obscure actual sensitive files: %+v", files)
			}
		})
	}
}

func TestUnsupportedHeadDoesNotCreateFalseExposure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusNotImplemented)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	admin := checkAdminSensitivePages(server.URL, "")
	files := checkSensitiveFileExposure(server.URL)
	if admin.Status != "pass" || files.Status != "pass" || len(admin.ServerErrors)+len(files.ServerErrors) != 0 {
		t.Fatalf("GET-confirmed missing resources should pass: admin=%+v files=%+v", admin, files)
	}
}
