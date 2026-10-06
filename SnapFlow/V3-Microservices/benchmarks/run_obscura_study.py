"""Launch isolated, matched Linux engines and record reproducible evidence.

Does not start or rebuild the production stack. Only study-owned containers
are removed; the caller chooses the Docker image and benchmark scope.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
OBSCURA="h4ckf0r0day/obscura@sha256:475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2"
IMAGE="snapflow/obscura-study:pw1.58"
NETWORK="snapflow-obscura-study"
CLIENT="snapflow-study-client"


def docker(*args,check=True,capture=False):
    return subprocess.run(["docker",*args],check=check,capture_output=capture,text=True,encoding="utf-8")


def owned_remove(name):
    result=docker("inspect",name,check=False,capture=True)
    if result.returncode:
        return
    state=json.loads(result.stdout)[0]
    if state["Config"].get("Labels",{}).get("snapflow.study")!="obscura-memory":
        raise RuntimeError(f"Refusing to remove container not owned by this study: {name}")
    docker("rm","-f",name,capture=True)


def main(args):
    output=ROOT/"output/playwright/obscura-study"
    output.mkdir(parents=True,exist_ok=True)
    existing=docker("network","inspect",NETWORK,check=False,capture=True)
    if existing.returncode:
        docker("network","create","--label","snapflow.study=obscura-memory",NETWORK,capture=True)
    owned_remove(CLIENT)
    docker("run","-d","--name",CLIENT,"--label","snapflow.study=obscura-memory","--network",NETWORK,
           "--env-file",str(HERE/"obscura.env"),
           "--mount",f"type=bind,src={output},dst=/results",
           "--mount","type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly",IMAGE,capture=True)
    inventory={"docker":json.loads(docker("info","--format","{{json .}}",capture=True).stdout),
               "obscura_image":json.loads(docker("image","inspect",OBSCURA,capture=True).stdout)[0]["Id"],
               "study_image":json.loads(docker("image","inspect",IMAGE,capture=True).stdout)[0]["Id"]}
    # Save only relevant hardware facts; Docker info can contain unrelated config.
    hardware=inventory.pop("docker")
    inventory["hardware"]={key:hardware.get(key) for key in ["NCPU","MemTotal","Architecture","KernelVersion","OperatingSystem","CgroupVersion"]}
    (output/"environment.json").write_text(json.dumps(inventory,indent=2),encoding="utf-8")
    try:
        for round_id in range(args.rounds):
            engines=["obscura","chromium"] if round_id%2==0 else ["chromium","obscura"]
            if args.workers_study:
                engines.append("obscura-w4")
            for variant in engines:
                saved=output/f"round-{round_id}-{variant}"/"study.json"
                if args.resume and saved.exists():
                    previous=json.loads(saved.read_text(encoding="utf-8"))
                    expected=6*args.repeats*len(args.concurrency)+(3 if args.live and variant!="obscura-w4" else 0)
                    if previous.get("completed_at") and len(previous.get("rows",[]))==expected:
                        print("Keeping completed observations",round_id,variant,flush=True)
                        continue
                engine="obscura" if variant.startswith("obscura") else "chromium"
                container=f"snapflow-study-{variant}"
                owned_remove(container)
                start=["run","-d","--name",container,"--label","snapflow.study=obscura-memory","--network",NETWORK,
                       "--cpus","2","--memory","2g","--shm-size","256m"]
                if engine=="obscura":
                    start += ["--env-file",str(HERE/"obscura.env"),OBSCURA]
                    if variant=="obscura-w4":
                        start += ["serve","--port","9222","--host","0.0.0.0","--workers","4"]
                    cdp=f"http://{container}:9222"
                else:
                    start += [IMAGE,"python","chromium_endpoint.py"]
                    cdp=f"http://{container}:9333"
                docker(*start,capture=True)
                time.sleep(2)
                study=["exec",CLIENT,"python","study.py","--engine",engine,"--engine-container",container,"--cdp-url",cdp,
                       "--output",f"/results/round-{round_id}-{variant}","--repeats",str(args.repeats),"--concurrency",*map(str,args.concurrency)]
                if args.live and variant!="obscura-w4":
                    study.append("--live")
                print("Starting",round_id,variant,flush=True)
                result=docker(*study,check=False)
                if result.returncode:
                    docker("logs","--tail","15",container)
                    raise RuntimeError(f"Study failed for {variant}")
                owned_remove(container)
    finally:
        for name in [CLIENT,"snapflow-study-obscura","snapflow-study-chromium","snapflow-study-obscura-w4"]:
            owned_remove(name)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--rounds",type=int,default=2)
    parser.add_argument("--repeats",type=int,default=3)
    parser.add_argument("--concurrency",type=int,nargs='+',default=[1,4,8])
    parser.add_argument("--live",action="store_true")
    parser.add_argument("--workers-study",action="store_true")
    parser.add_argument("--resume",action="store_true")
    main(parser.parse_args())
