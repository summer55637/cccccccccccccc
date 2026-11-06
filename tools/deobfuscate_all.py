"""
小樹放置天堂 - JavaScript 反混淆與字串解密工具 (String Array & Wrapper Inliner)
適用對象：javascript-obfuscator 混淆之主遊戲 Bundle (index.js / goline-adapter.js)
"""

import json
import re
import os
import sys

def deobfuscate_file(js_path, dict_path, out_path, is_adapter=False):
    print(f"[*] 處理檔案: {js_path}")
    if not os.path.exists(js_path) or not os.path.exists(dict_path):
        print(f"[-] 檔案不存在: {js_path} 或 {dict_path}")
        return

    with open(dict_path, 'r', encoding='utf-8') as f:
        str_dict = json.load(f)

    with open(js_path, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()

    # 匹配 2 參數 wrapper 函數
    dec_fn_name = "_0x5375" if is_adapter else "_0x3f73"
    wrapper_pat = re.compile(rf'function (_0x[a-f0-9]+)\((_0x[a-f0-9]+),(_0x[a-f0-9]+)\)\{{return {dec_fn_name}\(([^)]+)\);\}}')
    
    wrappers = {}
    for m in wrapper_pat.finditer(text):
        fname, p1, p2, expr = m.groups()
        wrappers[fname] = (p1, p2, expr)

    print(f"[+] 找到 {len(wrappers)} 個解碼 wrapper 函式")

    def eval_wrapper(fname, arg1, arg2):
        if fname not in wrappers:
            return None
        p1, p2, expr = wrappers[fname]
        parts = [p.strip() for p in expr.split(',')]
        idx_expr = parts[0]
        e = idx_expr.replace(p1, str(arg1)).replace(p2, str(arg2))
        try:
            idx = eval(e)
            return str_dict.get(str(idx))
        except Exception:
            return None

    call_pat = re.compile(r'(_0x[a-f0-9]+)\(([-+]?0x[a-f0-9]+|[-+]?\d+),\s*([-+]?0x[a-f0-9]+|[-+]?\d+)\)')
    replaced = 0

    def replace_call(m):
        nonlocal replaced
        fname, a1, a2 = m.groups()
        try:
            v1 = int(a1, 0)
            v2 = int(a2, 0)
        except:
            return m.group(0)
        val = eval_wrapper(fname, v1, v2)
        if val is not None:
            replaced += 1
            return json.dumps(val, ensure_ascii=False)
        return m.group(0)

    deobf_text = call_pat.sub(replace_call, text)
    print(f"[+] 成功替換 {replaced} 處字串調用")

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(deobf_text)
    print(f"[+] 輸出反混淆檔案至: {out_path}\n")

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # 處理 index.js
    main_js = os.path.join(base_dir, 'client', 'assets', 'main', 'index.3e757.js')
    main_dict = os.path.join(base_dir, 'client', 'decoded_strings_main.json')
    main_out = os.path.join(base_dir, 'client', 'assets', 'main', 'index.deobf.js')
    deobfuscate_file(main_js, main_dict, main_out, is_adapter=False)

    # 處理 goline-adapter.js
    adapter_js = os.path.join(base_dir, 'client', 'src', 'assets', 'scripts', 'net', 'goline-adapter.8231b.js')
    adapter_dict = os.path.join(base_dir, 'client', 'decoded_strings_adapter.json')
    adapter_out = os.path.join(base_dir, 'client', 'src', 'assets', 'scripts', 'net', 'goline-adapter.deobf.js')
    deobfuscate_file(adapter_js, adapter_dict, adapter_out, is_adapter=True)
