#!/usr/bin/env python3
"""Local stand-in for the Anthropic Messages API and OpenAI-compatible chat completions, for exercising the app without a real key.

Usage:  python3 tests/mock-anthropic.py 8090
Then in the app settings set API 地址 = http://localhost:8090 and any non-empty key.

Behaviour:
- x-api-key "bad"            -> 401 authentication_error
- prompt containing "SLOW"   -> streams 40 chunks with 150 ms gaps (for testing 停止)
- prompt containing "REFUSE" -> stop_reason "refusal"
- otherwise                  -> a short Chinese answer that quotes the prompt, streamed or not
"""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090

def cors(h):
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    h.send_header('Access-Control-Allow-Headers', '*')
    h.send_header('Access-Control-Expose-Headers', 'request-id')
    h.send_header('Access-Control-Max-Age', '600')

def answer_for(body):
    msgs = body.get('messages') or []
    text = ''
    for m in msgs:
        c = m.get('content')
        if isinstance(c, str): text += c
        elif isinstance(c, list): text += ''.join(b.get('text', '') for b in c if isinstance(b, dict))
    head = text.replace('\n', ' ')[:60]
    if '写一份导读' in text:
        return ('## 一句话总结\n本文提出 junction tree VAE，先生成分子的骨架树再组装成图，生成的分子 100% 有效（第 1 页）。\n\n## 要解决的问题\n基于 SMILES 的生成容易写出无效分子（第 2 页）。\n\n## 核心思想\n先粗后细：树解码器决定有哪些子结构，图解码器决定怎么拼（第 3 页）。\n\n## 术语表\n- **junction tree（联结树）**：把分子按环和键拆成簇后连成的树，解码的第一阶段对象（第 2 页）。\n- **scaffold**：生成分子时先搭出来的骨架。\n- **SMILES**: 把分子写成一行字符串的表示法。\n- **KL 散度**：两个分布之间差异的度量，VAE 用它约束潜空间。\n\n## 读完检验\n1. 为什么先生成树再生成图？\n2. 子结构词汇表怎么来的？\n3. 有效性 100% 说明了什么？\n\n这是本地模拟服务生成的导读，不是真实模型。')
    if '逐段翻译' in text:
        import re as _re
        ids = _re.findall(r'^\[(\d+)\] ', text, _re.M)
        return '\n\n'.join('[%s] （模拟译文 %s）这是第 %s 段的中文翻译。' % (i, i, i) for i in ids)
    if '翻译' in text and '原文' in text:
        return '（模拟译文）' + head + '…\n\n这是本地模拟服务返回的内容，不是真实模型。'
    return ('## 一句话\n分子图记作 $G=(V,E)$：原子是顶点 $V$，化学键是边 $E$（第 2 页）。\n\n## 直观理解\n这是本地模拟服务生成的回答，用于验证界面链路。解码分两阶段：\n\n1. 用 tree decoder 从 $z_T$ 生成 junction tree：$p(T\\mid z_T)$\n2. 用 graph decoder 组装分子：$p(G\\mid T, z_G)$\n   - 子结构词汇表 $|X| = 780$（第 3 页）\n   - 潜表示 \\(z = [z_T, z_G]\\)\n\n$$\\mathcal{L} = \\mathbb{E}_{q(z|x)}[\\log p(x\\mid z)] - \\mathrm{KL}(q(z\\mid x)\\,\\|\\,p(z))$$\n\n> 注意：这里的 scaffold 不同于药物化学里的 Murcko scaffold。\n\n---\n\n'
            '## 收到的请求\n前 60 字：`' + head + '`\n\n- 模型：' + str(body.get('model')) + '\n- effort：' + str((body.get('output_config') or {}).get('effort')) + '\n- 收到字符数：' + str(len(text)) + '\n\n'
            '| 方案 | 特点 |\n|---|---|\n| SMILES | 线性字符串 |\n| 分子图 | 节点和边 |\n\n'
            '```mermaid\nflowchart TD\n  subgraph 编码\n    A([分子图 G]) -- 树分解 --> B([junction tree T])\n  end\n  subgraph 解码\n    C(树解码器) -- 节点序列 --> D(图解码器)\n  end\n  B -- 编码 zT, zG --> C\n  D --> E([完整分子])\n  classDef input fill:#e3f2fd,stroke:#1e88e5,color:#0d3b66; classDef op fill:#fff8e1,stroke:#f9a825,color:#5d4200\n  classDef out fill:#e8f5e9,stroke:#43a047,color:#1b4d2b\n  class A,B input\n  class C,D op\n  class E out\n```\n上图是方法的两阶段流程。\n\n'
            '```svg\n<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="220" fill="#fff"/><circle cx="120" cy="110" r="40" fill="#e3f2fd" stroke="#1e88e5" stroke-width="3"/><text x="120" y="118" font-size="26" text-anchor="middle">C</text><circle cx="300" cy="110" r="40" fill="#e3f2fd" stroke="#1e88e5" stroke-width="3"/><text x="300" y="118" font-size="26" text-anchor="middle">C</text><circle cx="480" cy="110" r="40" fill="#e8f5e9" stroke="#43a047" stroke-width="3"/><text x="480" y="118" font-size="26" text-anchor="middle">O</text><line x1="160" y1="110" x2="260" y2="110" stroke="#333" stroke-width="4"/><line x1="340" y1="110" x2="440" y2="110" stroke="#333" stroke-width="4"/><text x="300" y="40" font-size="18" text-anchor="middle" fill="#2f7a4f">CCO →</text><text x="300" y="195" font-size="18" text-anchor="middle" fill="#c08a2e">← OCC</text><script>alert(1)</script></svg>\n```\n同一个分子图从不同原子出发遍历，写出不同的 SMILES。\n\n'
            '**检验问题**：如果这里是真实模型，回答会不同吗？')

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, fmt, *args):
        sys.stderr.write('[mock] ' + (fmt % args) + '\n')

    def do_OPTIONS(self):
        self.send_response(204); cors(self); self.send_header('Content-Length', '0'); self.end_headers()

    def do_POST(self):
        if self.path.rstrip('/').endswith('/chat/completions'):
            return self.openai_compatible()
        if not self.path.startswith('/v1/messages'):
            self.send_response(404); cors(self); self.send_header('Content-Length', '0'); self.end_headers(); return
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        key = self.headers.get('x-api-key', '')
        if key == 'bad' or not key:
            payload = json.dumps({'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}).encode()
            self.send_response(401); cors(self); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        model = body.get('model', 'mock-model')
        text = answer_for(body)
        full = json.dumps(body, ensure_ascii=False)
        refuse = 'REFUSE' in full
        slow = 'SLOW' in full
        if not body.get('stream'):
            msg = {'id': 'msg_mock', 'type': 'message', 'role': 'assistant', 'model': model,
                   'content': [] if refuse else [{'type': 'text', 'text': '连接正常（模拟服务）'}],
                   'stop_reason': 'refusal' if refuse else 'end_turn', 'stop_sequence': None,
                   'stop_details': {'type': 'refusal', 'category': 'test', 'explanation': '模拟拒绝'} if refuse else None,
                   'usage': {'input_tokens': 12, 'output_tokens': 6}}
            payload = json.dumps(msg, ensure_ascii=False).encode()
            self.send_response(200); cors(self); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        self.send_response(200); cors(self)
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close')
        self.end_headers()
        def ev(t, d):
            self.wfile.write(('event: %s\ndata: %s\n\n' % (t, json.dumps(d, ensure_ascii=False))).encode('utf-8')); self.wfile.flush()
        ev('message_start', {'type': 'message_start', 'message': {'id': 'msg_mock', 'type': 'message', 'role': 'assistant', 'model': model, 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 12, 'output_tokens': 0}}})
        if refuse:
            ev('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'refusal', 'stop_sequence': None, 'stop_details': {'type': 'refusal', 'category': 'test', 'explanation': '模拟拒绝'}}, 'usage': {'output_tokens': 0}})
            ev('message_stop', {'type': 'message_stop'}); return
        ev('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})
        if slow:
            chunks = ['慢速输出 %d / 40 … ' % i for i in range(1, 41)]
        else:
            size = 8
            chunks = [text[i:i + size] for i in range(0, len(text), size)]
        try:
            for c in chunks:
                ev('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': c}})
                time.sleep(0.15 if slow else 0.02)
        except (BrokenPipeError, ConnectionResetError):
            sys.stderr.write('[mock] client aborted stream\n'); return
        ev('content_block_stop', {'type': 'content_block_stop', 'index': 0})
        ev('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': len(chunks)}})
        ev('message_stop', {'type': 'message_stop'})

    # OpenAI-compatible chat completions (DeepSeek / OpenAI style), same keywords as above.
    def openai_compatible(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}')
        auth = self.headers.get('Authorization', '')
        key = auth[7:] if auth.startswith('Bearer ') else ''
        if key == 'bad' or not key:
            payload = json.dumps({'error': {'message': 'Authentication Fails, Your api key is invalid', 'type': 'authentication_error', 'code': 'invalid_request_error'}}).encode()
            self.send_response(401); cors(self); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        model = body.get('model', 'mock-model')
        text = answer_for(body)
        full = json.dumps(body, ensure_ascii=False)
        slow = 'SLOW' in full
        if not body.get('stream'):
            msg = {'id': 'chatcmpl-mock', 'object': 'chat.completion', 'model': model, 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '连接正常（模拟服务）'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 12, 'completion_tokens': 6, 'total_tokens': 18}}
            payload = json.dumps(msg, ensure_ascii=False).encode()
            self.send_response(200); cors(self); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload); return
        self.send_response(200); cors(self)
        self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close')
        self.end_headers()
        def chunk(delta, finish=None):
            d = {'id': 'chatcmpl-mock', 'object': 'chat.completion.chunk', 'model': model, 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
            self.wfile.write(('data: ' + json.dumps(d, ensure_ascii=False) + '\n\n').encode('utf-8')); self.wfile.flush()
        chunk({'role': 'assistant', 'content': ''})
        pieces = ['慢速输出 %d / 40 … ' % i for i in range(1, 41)] if slow else [text[i:i + 8] for i in range(0, len(text), 8)]
        try:
            for c in pieces:
                chunk({'content': c}); time.sleep(0.15 if slow else 0.02)
        except (BrokenPipeError, ConnectionResetError):
            sys.stderr.write('[mock] client aborted stream\n'); return
        chunk({}, 'stop')
        self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()

if __name__ == '__main__':
    print('mock anthropic api on http://localhost:%d' % PORT, flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
