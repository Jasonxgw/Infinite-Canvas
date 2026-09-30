#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把文件夹里按 P 编号命名的视频，按编号从小到大拼成一个整片。

命名规则：文件名里含 `P01` / `p12` / `P030` 这类编号的就参与拼接，按编号升序排。
带字母后缀的（`P01B`）排在 `P01` 之后，用来插在中间也放得对。
缺号不影响，缺的视频直接跳过。

用法：
    python concat_videos.py "assets/library/剧本 1/生成视频"
    python concat_videos.py "assets/library/剧本 2/生成视频" -o 剧本2合集.mp4
    python concat_videos.py <文件夹> --start 1 --end 120 --dry-run

默认走「无损拼接」：不重新编码，只把码流接起来，速度快、画质一点不掉。
只有各视频的编码参数（分辨率/编码/采样率）不一致时才需要 --reencode。
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".flv", ".ts", ".wmv")

# 文件名里的分镜编号：前面不能紧挨着字母数字（避开 lib_xxx 那种十六进制串），
# 形如 _P01、P02、P01B
CODE_RE = re.compile(r"(?:^|[^0-9A-Za-z])[Pp](\d{1,4})([A-Za-z])?")

VIDEO_LINE_RE = re.compile(r"Video:\s*([A-Za-z0-9_]+).*?(\d{2,5})x(\d{2,5})")
FPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*fps")
AUDIO_LINE_RE = re.compile(r"Audio:\s*([A-Za-z0-9_]+).*?(\d+)\s*Hz,\s*([A-Za-z0-9.]+)")
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)")


def find_ffmpeg():
    """优先用装在本项目 python 里的那份（自包含），其次找 PATH 上的。"""
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    sys.exit(
        "找不到 ffmpeg。装一份自包含的即可：\n"
        r'  .\python\python.exe -m pip install imageio-ffmpeg'
    )


FFMPEG = None


def run(args, **kwargs):
    return subprocess.run(
        [FFMPEG, "-hide_banner"] + args, capture_output=True, text=True,
        errors="ignore", **kwargs
    )


def probe(path):
    """读出这个视频的编码参数与时长，用来判断能不能直接无损拼接。"""
    out = run(["-i", path]).stderr
    video = VIDEO_LINE_RE.search(out)
    audio = AUDIO_LINE_RE.search(out)
    fps = FPS_RE.search(out)
    duration = DURATION_RE.search(out)
    seconds = 0.0
    if duration:
        seconds = int(duration.group(1)) * 3600 + int(duration.group(2)) * 60 + float(duration.group(3))
    return {
        "vcodec": video.group(1) if video else "?",
        "size": f"{video.group(2)}x{video.group(3)}" if video else "?",
        "fps": (fps.group(1) if fps else "?"),
        "acodec": audio.group(1) if audio else "none",
        "rate": int(audio.group(2)) if audio else 0,
        "layout": audio.group(3) if audio else "none",
        "seconds": seconds,
    }


def spec_of(info):
    return (info["vcodec"], info["size"], info["fps"], info["acodec"], info["rate"], info["layout"])


def format_seconds(total):
    total = int(round(total))
    return f"{total // 60}分{total % 60}秒"


def code_of(name):
    """取文件名里的分镜编号，返回 (数字, 字母后缀) 用来排序；没有编号返回 None。"""
    found = CODE_RE.search(name)
    if not found:
        return None
    return (int(found.group(1)), (found.group(2) or "").upper())


def missing_ranges(numbers):
    """把缺掉的编号压成 3-8 这样的区间，方便一眼看出空在哪。"""
    if not numbers:
        return []
    known = set(numbers)
    low, high = min(numbers), max(numbers)
    gaps = [n for n in range(low, high + 1) if n not in known]
    ranges = []
    start = prev = None
    for n in gaps:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            ranges.append((start, prev))
            start = prev = n
    if start is not None:
        ranges.append((start, prev))
    return [f"{a}" if a == b else f"{a}-{b}" for a, b in ranges]


def stage_inputs(entries, workdir):
    """把要拼的文件按顺序硬链接（不行就复制）成 0001.mp4 这种简单名字。

    拼接列表里带中文和空格的文件名在 Windows 上容易被引号规则坑到，
    统一换成纯 ASCII 的短名字最稳；硬链接不占额外磁盘。
    """
    staged = []
    for index, entry in enumerate(entries, 1):
        ext = os.path.splitext(entry["path"])[1].lower() or ".mp4"
        target = os.path.join(workdir, f"{index:05d}{ext}")
        try:
            os.link(entry["path"], target)
        except Exception:
            shutil.copy2(entry["path"], target)
        staged.append(target)
    return staged


def write_concat_list(paths, list_path):
    with open(list_path, "w", encoding="utf-8", newline="\n") as f:
        for path in paths:
            safe = path.replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe}'\n")


def concat_copy(list_path, output):
    return run(["-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy",
                "-movflags", "+faststart", output])


def reencode_one(src, dst, info):
    """把一条视频统一到同一套参数上（只有参数不一致时才走这条路）。"""
    width, height = info["size"].split("x")
    fps = info["fps"] if info["fps"] not in ("", "?") else "24"
    scale = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )
    args = ["-y", "-i", src, "-vf", scale, "-r", fps,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
    if info["acodec"] == "none":
        args += ["-an"]
    else:
        args += ["-c:a", "aac", "-ar", str(info["rate"] or 32000),
                 "-ac", "1" if info["layout"] == "mono" else "2"]
    return run(args + [dst])


def main():
    global FFMPEG

    parser = argparse.ArgumentParser(
        description="把文件夹里按 P 编号命名的视频按编号顺序拼成一个整片",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("folder", help="视频所在文件夹")
    parser.add_argument("-o", "--output", default="", help="输出文件（默认放在该文件夹里，叫「<文件夹名>-合集.mp4」）")
    parser.add_argument("--start", type=int, default=None, help="只要编号 >= 这个值的（例：--start 1）")
    parser.add_argument("--end", type=int, default=None, help="只要编号 <= 这个值的（例：--end 120）")
    parser.add_argument("--dry-run", action="store_true", help="只列出拼接顺序和缺号，不真的拼")
    parser.add_argument("--reencode", action="store_true", help="强制重新编码（参数不一致时才需要，慢）")
    parser.add_argument("--workers", type=int, default=8, help="探测编码参数的并发数（默认 8）")
    args = parser.parse_args()

    folder = os.path.abspath(args.folder)
    if not os.path.isdir(folder):
        sys.exit(f"文件夹不存在：{folder}")

    FFMPEG = find_ffmpeg()

    entries = []
    skipped = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if not os.path.isfile(path) or os.path.splitext(name)[1].lower() not in VIDEO_EXTS:
            continue
        code = code_of(name)
        if not code:
            skipped.append(name)
            continue
        number, suffix = code
        if args.start is not None and number < args.start:
            continue
        if args.end is not None and number > args.end:
            continue
        entries.append({"name": name, "path": path, "number": number, "suffix": suffix})

    if not entries:
        sys.exit("这个文件夹里没有找到带 P 编号的视频。")

    # 编号升序；同一个编号的按字母后缀排（P01 → P01B），再按文件名保证顺序稳定
    entries.sort(key=lambda item: (item["number"], item["suffix"], item["name"]))

    output = args.output or os.path.join(folder, f"{os.path.basename(folder)}-合集.mp4")
    output = os.path.abspath(output)
    entries = [item for item in entries if os.path.abspath(item["path"]) != output]

    print(f"文件夹：{folder}")
    print(f"参与拼接：{len(entries)} 个视频（P{entries[0]['number']} → P{entries[-1]['number']}）")
    if skipped:
        print(f"文件名里没有 P 编号、已跳过：{len(skipped)} 个（例：{skipped[0]}）")
    gaps = missing_ranges([item["number"] for item in entries])
    if gaps:
        print(f"缺号（直接跳过）：{', '.join(gaps)}")

    # 探测编码参数：都一样就能无损直接接
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        infos = list(pool.map(lambda item: probe(item["path"]), entries))
    for item, info in zip(entries, infos):
        item["info"] = info

    specs = {}
    for item in entries:
        specs.setdefault(spec_of(item["info"]), []).append(item["name"])
    uniform = len(specs) == 1
    total_seconds = sum(info["seconds"] for info in infos)
    print(f"预计时长：约 {format_seconds(total_seconds)}")

    if not uniform and not args.reencode:
        print()
        print(f"注意：这批视频的编码参数不一致（{len(specs)} 种）：")
        for spec, names in sorted(specs.items(), key=lambda row: -len(row[1])):
            print(f"  {len(names):>5} 个 · {spec[0]} {spec[1]} {spec[2]}fps "
                  f"· {spec[3]} {spec[4]}Hz {spec[5]}（例：{names[0]}）")
        print()
        print("无损拼接只对参数一致的文件成立，参数不同接出来会花屏或音画错位。")
        print("加 --reencode 会把全部视频统一到上面第一个规格再拼（要重新编码，慢很多）。")
        sys.exit(1)

    if args.dry_run:
        print()
        print("拼接顺序（--dry-run，不真的拼）：")
        for index, item in enumerate(entries, 1):
            print(f"  {index:>4}. P{item['number']:02d}{item['suffix']}  {item['name']}")
        return

    mode = "重新编码后拼接" if args.reencode else "无损拼接（不重新编码）"
    print(f"拼接方式：{mode}")
    print(f"输出：{output}")
    print()

    # 输出放在盘根时 dirname 会带尾部反斜杠，join 出来是 "D:\\concat_xxx" 这种双反斜杠路径，
    # Windows 上 mkdir 会直接拒绝访问，normpath 先把分隔符收干净再建目录。
    workroot = os.path.dirname(output) or folder
    workdir = os.path.normpath(os.path.join(workroot, f"concat_{os.getpid()}_{int(time.time())}"))
    os.makedirs(workdir, exist_ok=False)
    try:
        if args.reencode:
            # 统一到出现次数最多的那套参数上
            base = max(specs.items(), key=lambda row: len(row[1]))[0]
            base_info = {"size": base[1], "fps": base[2], "acodec": base[3],
                         "rate": base[4], "layout": base[5]}
            encdir = os.path.join(workdir, "enc")
            os.makedirs(encdir, exist_ok=True)
            paths = []
            for index, item in enumerate(entries, 1):
                target = os.path.join(encdir, f"{index:05d}.mp4")
                print(f"  转码 {index}/{len(entries)}  {item['name']}", flush=True)
                result = reencode_one(item["path"], target, base_info)
                if result.returncode != 0:
                    sys.exit(f"转码失败：{item['name']}\n{result.stderr[-800:]}")
                paths.append(target)
        else:
            paths = stage_inputs(entries, workdir)

        list_path = os.path.join(workdir, "list.txt")
        write_concat_list(paths, list_path)
        print(f"正在拼接 {len(paths)} 段…", flush=True)
        result = concat_copy(list_path, output)
        if result.returncode != 0:
            print(result.stderr[-3000:])
            if not args.reencode:
                print("\n无损拼接失败。多数是各视频编码参数不一致，加 --reencode 再试。")
            sys.exit(1)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    final = probe(output)
    size_mb = os.path.getsize(output) / 1024 / 1024
    print()
    print("完成。")
    print(f"  文件：{output}")
    print(f"  大小：{size_mb:.1f} MB")
    print(f"  时长：{format_seconds(final['seconds'])}（{final['size']} {final['vcodec']} {final['fps']}fps）")


if __name__ == "__main__":
    main()
