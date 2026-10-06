FROM h4ckf0r0day/obscura@sha256:475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2
COPY --chmod=755 output/playwright/obscura-study/stealth-release/obscura /obscura
COPY --chmod=755 output/playwright/obscura-study/stealth-release/obscura-worker /obscura-worker
