#!/usr/bin/env python3
"""Build a deterministic ZIP containing only the self-contained offline web app."""
from __future__ import annotations
import argparse, hashlib, json, os, re, tempfile, zipfile
from pathlib import Path, PurePosixPath

ALLOWED_ROOTS = {
    "offline/character/ui": {".html", ".css", ".js"},
    "offline/game": {".html", ".css", ".js"},
    "offline/storage": {".js"},
}
FIXED_FILES = ("offline/service-worker.js", "offline/manifest.webmanifest")
REQUIRED_ENTRIES = {
    "offline/character/ui/index.html", "offline/game/index.html",
    "offline/service-worker.js", "offline/manifest.webmanifest",
    "offline/icons/icon-192.png", "offline/icons/icon-512.png",
}
TEXT_EXTENSIONS = {".html", ".css", ".js", ".webmanifest"}
EXTERNAL_URL = re.compile(r"https?://|(?:^|[\s\"'=])//[a-z0-9.-]+\.[a-z]{2,}", re.I)
SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.I),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"""\b(?:api[_-]?key|client[_-]?secret|password|passwd|token|access[_-]?token|refresh[_-]?token|session[_-]?token|private[_-]?key|encryption[_-]?key|secret)\b\s*[:=]\s*(['"])([^'"]{16,})\1""", re.I),
)

class ReleaseBuildError(RuntimeError):
    pass

def safe_relative(path: str) -> str:
    pure=PurePosixPath(path)
    if pure.is_absolute() or not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
        raise ReleaseBuildError("不安全的套件路徑："+path)
    return pure.as_posix()

def collect_release_files(repository_root: Path) -> list[Path]:
    root=repository_root.resolve()
    offline_root=root/"offline"
    if not offline_root.is_dir():
        raise ReleaseBuildError("找不到 offline/ 單機版資料夾。")
    selected={}
    for directory,extensions in ALLOWED_ROOTS.items():
        source_dir=root/directory
        if not source_dir.is_dir():
            raise ReleaseBuildError("缺少必要目錄："+directory)
        for candidate in sorted(source_dir.rglob("*")):
            if candidate.is_symlink():
                raise ReleaseBuildError("正式程式目錄不允許符號連結："+candidate.relative_to(root).as_posix())
            if not candidate.is_file() or candidate.suffix.lower() not in extensions:
                continue
            rel=safe_relative(candidate.relative_to(root).as_posix())
            try:
                candidate.resolve(strict=True).relative_to(root)
            except ValueError as error:
                raise ReleaseBuildError("檔案超出倉庫根目錄："+rel) from error
            selected[rel]=candidate
    for rel in FIXED_FILES:
        candidate=root/rel
        if not candidate.is_file() or candidate.is_symlink():
            raise ReleaseBuildError("缺少必要正式檔案："+rel)
        selected[rel]=candidate
    icon_dir=offline_root/"icons"
    if not icon_dir.is_dir():
        raise ReleaseBuildError("缺少 PWA 圖示目錄。")
    for candidate in sorted(icon_dir.glob("*.png")):
        if candidate.is_symlink() or not candidate.is_file():
            raise ReleaseBuildError("圖示必須是一般檔案："+candidate.name)
        selected[safe_relative(candidate.relative_to(root).as_posix())]=candidate
    if not REQUIRED_ENTRIES.issubset(selected):
        raise ReleaseBuildError("缺少必要發布檔案："+", ".join(sorted(REQUIRED_ENTRIES-set(selected))))

    worker=(offline_root/"service-worker.js").read_text(encoding="utf-8")
    match=re.search(r"const\s+PRECACHE_ASSETS\s*=\s*\[(.*?)\]\s*;",worker,re.S)
    if not match:
        raise ReleaseBuildError("無法解析 Service Worker 預快取清單。")
    assets=re.findall(r"""["'](\./[^"']+)["']""",match.group(1))
    if not assets:
        raise ReleaseBuildError("Service Worker 預快取清單為空。")
    for asset in assets:
        rel=safe_relative("offline/"+asset[2:])
        if rel not in selected:
            raise ReleaseBuildError("預快取資源未納入發布套件或不存在："+rel)

    try:
        manifest=json.loads((offline_root/"manifest.webmanifest").read_text(encoding="utf-8"))
    except (OSError,json.JSONDecodeError) as error:
        raise ReleaseBuildError("PWA manifest 無法解析。") from error
    if manifest.get("scope")!="./" or manifest.get("start_url")!="./character/ui/index.html":
        raise ReleaseBuildError("PWA manifest 的 scope 或 start_url 不符合離線版範圍。")
    for icon in manifest.get("icons",[]):
        src=str(icon.get("src",""))
        if not src.startswith("./"):
            raise ReleaseBuildError("PWA 圖示路徑必須位於單機版目錄。")
        rel=safe_relative("offline/"+src[2:])
        if rel not in selected:
            raise ReleaseBuildError("PWA manifest 圖示未納入發布套件："+rel)
        png=(root/rel).read_bytes()
        if len(png)<24 or png[:8]!=b"\x89PNG\r\n\x1a\n":
            raise ReleaseBuildError("PWA 圖示不是有效 PNG："+rel)
        width=int.from_bytes(png[16:20],"big")
        height=int.from_bytes(png[20:24],"big")
        declared=icon.get("sizes","")
        if declared and declared!=f"{width}x{height}":
            raise ReleaseBuildError("PWA 圖示尺寸與 manifest 不符："+rel)

    for rel,candidate in selected.items():
        if candidate.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        content=candidate.read_text(encoding="utf-8")
        if EXTERNAL_URL.search(content):
            raise ReleaseBuildError("發布來源含外部網址："+rel)
        if any(pattern.search(content) for pattern in SECRET_PATTERNS):
            raise ReleaseBuildError("發布來源疑似含硬編碼機密："+rel)
    return [selected[name] for name in sorted(selected)]

def build_release(repository_root: Path, output_path: Path) -> dict:
    root=repository_root.resolve()
    output=output_path if output_path.is_absolute() else root/output_path
    output=output.resolve()
    try:
        output.relative_to((root/"offline").resolve())
    except ValueError:
        pass
    else:
        raise ReleaseBuildError("ZIP 輸出位置不可放在 offline/ 來源目錄內。")
    files=collect_release_files(root)
    entries=[]
    payloads=[]
    for source in files:
        rel=source.relative_to(root).as_posix()
        data=source.read_bytes()
        payloads.append((rel,data))
        entries.append({"path":rel,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
    release_manifest={
        "schemaVersion":1,
        "application":"offline-adventure",
        "commit":os.environ.get("GITHUB_SHA") or None,
        "files":entries,
    }
    manifest_bytes=(json.dumps(release_manifest,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    output.parent.mkdir(parents=True,exist_ok=True)
    temp_name=None
    try:
        with tempfile.NamedTemporaryFile(prefix="offline-release-",suffix=".tmp",dir=output.parent,delete=False) as handle:
            temp_name=handle.name
        with zipfile.ZipFile(temp_name,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for rel,data in payloads:
                info=zipfile.ZipInfo(rel,date_time=(1980,1,1,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED
                info.external_attr=0o100644<<16
                archive.writestr(info,data)
            info=zipfile.ZipInfo("offline/RELEASE-MANIFEST.json",date_time=(1980,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644<<16
            archive.writestr(info,manifest_bytes)
        os.replace(temp_name,output)
        temp_name=None
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)
    return {"output":str(output),"files":len(entries),"archive_bytes":output.stat().st_size,"manifest_entry":"offline/RELEASE-MANIFEST.json"}

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output",type=Path,default=Path("dist/offline-adventure-release.zip"))
    args=parser.parse_args()
    try:
        result=build_release(args.root,args.output)
    except (OSError,ReleaseBuildError) as error:
        parser.exit(2,"發布套件建立失敗："+str(error)+"\n")
    print(json.dumps(result,ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
