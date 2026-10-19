"""Source analysis and immutable, before-line snapshots for small Python runs.

This module never evaluates user expressions to infer what a line did. Only
CPython trace events supply state. It is a teaching tool, not a sandbox.
"""
import ast
import builtins
import contextlib
import dis
import inspect
import io
import json
import math
import sys
import time
import __future__

FILENAME = "<array-stepper>"
# The worker supplies the same policy file used by its hard watchdog.
LIMITS = json.loads(_runtime_limits_json)
MAX_SOURCE = LIMITS['maxSource']
MAX_STEPS = LIMITS['maxSteps']
MAX_SECONDS = LIMITS['maxSeconds']
MAX_BYTES = LIMITS['maxBytes']
MAX_ARRAY = LIMITS['maxArray']
MAX_DEPTH = LIMITS['maxDepth']
ALLOWED_IMPORTS = frozenset({
    "math", "bisect", "heapq", "collections", "functools", "itertools",
    "operator", "statistics", "typing", "random", "__future__",
})


class TraceLimit(BaseException):
    pass


def _parse(source):
    if len(source) > MAX_SOURCE:
        raise ValueError(f"Code exceeds the {MAX_SOURCE:,}-character limit.")
    tree = ast.parse(source, filename=FILENAME)
    entry_names = [node.name for node in tree.body if isinstance(node, ast.FunctionDef)]
    if len(entry_names) != len(set(entry_names)):
        raise ValueError("Give each top-level function a unique name.")
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.Yield,
                             ast.YieldFrom, ast.GeneratorExp, ast.ClassDef)):
            raise ValueError("Use synchronous functions without classes or generators in this version.")
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list or node.args.vararg or node.args.kwarg:
                raise ValueError("Decorators, *args, and **kwargs are not supported in this version.")
            for default in node.args.defaults + [d for d in node.args.kw_defaults if d is not None]:
                try:
                    ast.literal_eval(default)
                except (ValueError, TypeError):
                    raise ValueError("Function defaults must be literal values, such as 0, None, or [].") from None
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            roots = ([item.name.split('.')[0] for item in node.names]
                     if isinstance(node, ast.Import) else [(node.module or '').split('.')[0]])
            if getattr(node, 'level', 0) or any(root not in ALLOWED_IMPORTS for root in roots):
                raise ValueError("Import not supported. Use math, bisect, heapq, collections, functools, itertools, operator, statistics, typing, or random.")
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.Import, ast.ImportFrom)):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
            try:
                ast.literal_eval(node.value)
                continue
            except (ValueError, TypeError):
                pass
        raise ValueError("Paste function definitions, imports, and literal constants. Supply the function call through the input fields.")
    return tree


class _LocalNames(ast.NodeVisitor):
    def __init__(self):
        self.names = set()

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Store):
            self.names.add(node.id)

    def visit_FunctionDef(self, node):
        self.names.add(node.name)  # Do not mix nested function scopes.

    def visit_Lambda(self, node):
        pass


def analyze(source):
    try:
        tree = _parse(source)
        functions = []
        for node in tree.body:
            if not isinstance(node, ast.FunctionDef):
                continue
            positional = node.args.posonlyargs + node.args.args
            defaults = [None] * (len(positional) - len(node.args.defaults)) + node.args.defaults
            parameters = []
            for arg, default, kind in [
                *[(a, d, "positional") for a, d in zip(positional, defaults)],
                *[(a, d, "keyword") for a, d in zip(node.args.kwonlyargs, node.args.kw_defaults)],
            ]:
                default_text = None
                if default is not None:
                    try:
                        default_text = json.dumps(ast.literal_eval(default), allow_nan=False)
                    except (ValueError, TypeError):
                        pass
                parameters.append({"name": arg.arg, "kind": kind,
                                   "required": default is None, "default": default_text})
            names = _LocalNames()
            for statement in node.body:
                names.visit(statement)
            names.names.update(p["name"] for p in parameters)
            functions.append({"name": node.name, "key": f"{node.name}:{node.lineno}",
                              "line": node.lineno, "parameters": parameters,
                              "locals": sorted(names.names)})
        return {"functions": functions}
    except (SyntaxError, ValueError, TypeError, RecursionError) as error:
        return {"functions": [], "error": {
            "message": str(error), "line": getattr(error, "lineno", None)}}


def _atom(value):
    kind = type(value)
    if value is None or kind is bool:
        return value
    if kind is int:
        if abs(value) <= 9_007_199_254_740_991:
            return value
        text = str(value) if value.bit_length() < 14_000 else f"<integer: {value.bit_length()} bits>"
        return {"kind": "number", "text": text}
    if kind is float:
        # JSON otherwise turns 2.0 into an indistinguishable JavaScript 2.
        # Preserve its Python spelling so it cannot become an index arrow.
        if math.isfinite(value) and not value.is_integer():
            return value
        return {"kind": "number", "text": repr(value)}
    if kind is str:
        return value if len(value) <= 160 else value[:160] + "…"
    return {"kind": "summary", "text": f"<{kind.__name__}>"}


def _value(value):
    if type(value) is list:
        if len(value) > MAX_ARRAY:
            raise TraceLimit(f"Array limit reached ({MAX_ARRAY:,} elements).")
        if all(type(item) in (int, float) for item in value):
            return [_atom(item) for item in value]
        return {"kind": "summary", "text": f"<list: {len(value)} items; not a flat numeric array>"}
    if type(value) in (tuple, dict, set, frozenset):
        return {"kind": "summary", "text": f"<{type(value).__name__}: {len(value)} items>"}
    return _atom(value)


class _Output(io.StringIO):
    def write(self, text):
        remaining = 4_096 - self.tell()
        if remaining > 0:
            super().write(text[:remaining])
        return len(text)


def _unsupported(*args, **kwargs):
    raise RuntimeError("Interactive input, files, and dynamic code execution are not supported.")


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split('.')[0] not in ALLOWED_IMPORTS:
        raise ImportError(f"Import '{name}' is not supported in this version.")
    return builtins.__import__(name, globals, locals, fromlist, level)


def _arguments(function, raw):
    signature = inspect.signature(function)
    supplied = {}
    for name, text in raw.items():
        if name not in signature.parameters:
            raise ValueError(f"Unknown argument: {name}.")
        if not text.strip():
            continue
        try:
            supplied[name] = json.loads(text, parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s)))
        except (ValueError, TypeError, RecursionError):
            raise ValueError(f"Input '{name}' must be valid JSON, such as [1, 2, 3], 7, true, or null.") from None
    positional, keywords = [], {}
    for name, parameter in signature.parameters.items():
        if name not in supplied and parameter.default is inspect.Parameter.empty:
            raise ValueError(f"Provide an input for '{name}'.")
        if parameter.kind is inspect.Parameter.POSITIONAL_ONLY:
            positional.append(supplied.get(name, parameter.default))
        elif name in supplied:
            keywords[name] = supplied[name]
    bound = signature.bind(*positional, **keywords)
    bound.apply_defaults()
    array_count = 0
    for name, value in bound.arguments.items():
        if type(value) is list:
            array_count += 1
            if len(value) > MAX_ARRAY:
                raise ValueError(f"Input '{name}' exceeds {MAX_ARRAY:,} elements.")
            if not all(type(x) in (int, float) and (type(x) is int or math.isfinite(x)) for x in value):
                raise ValueError(f"Input '{name}' must be a flat array of finite numbers.")
        elif type(value) not in (int, float, str, bool, type(None)) or (type(value) is float and not math.isfinite(value)):
            raise ValueError(f"Input '{name}' must be a number, string, boolean, or null.")
    if array_count != 1:
        raise ValueError("Provide exactly one numeric array argument. Other arguments must be scalar values.")
    return bound.args, bound.kwargs


def record(source, entry, raw_inputs, emit, *, max_steps=MAX_STEPS, max_seconds=MAX_SECONDS, max_bytes=MAX_BYTES):
    """Emit detached JSON snapshots. Return a terminal outcome, not another step.

    Limits are checked inside tracing and independently by the host worker
    controller. Host termination also covers blocking native/library calls.
    """
    started = time.perf_counter()
    output = _Output()
    count = 0
    byte_count = 0
    frame_ids = {}
    frame_errors = {}
    next_frame_id = 0
    last_line = None
    outcome = {"status": "complete", "message": "Run complete."}

    def trace(frame, event, arg):
        nonlocal count, byte_count, next_frame_id, last_line
        if frame.f_code.co_filename != FILENAME or frame.f_code.co_name == "<module>":
            return None
        if event not in ("line", "return", "exception"):
            return trace
        if count >= max_steps:
            raise TraceLimit(f"Step limit reached ({max_steps:,} steps).")
        if time.perf_counter() - started >= max_seconds:
            raise TraceLimit(f"Execution limit reached ({max_seconds:g} seconds).")
        stack, current = [], frame
        while current is not None:
            if current.f_code.co_filename == FILENAME and current.f_code.co_name != "<module>":
                stack.append(current)
            current = current.f_back
        if len(stack) > MAX_DEPTH:
            raise TraceLimit(f"Call-depth limit reached ({MAX_DEPTH} frames).")
        frames = []
        for current in reversed(stack):
            address = id(current)
            if address not in frame_ids:
                next_frame_id += 1
                frame_ids[address] = next_frame_id
            code = current.f_code
            local_items = list(current.f_locals.items())
            if len(local_items) > LIMITS['maxVariables']:
                raise TraceLimit(f"Variable limit reached ({LIMITS['maxVariables']} variables per frame).")
            frames.append({
                "id": frame_ids[address], "name": code.co_name,
                "key": f"{code.co_name}:{code.co_firstlineno}", "line": current.f_lineno,
                "parameters": list(code.co_varnames[:code.co_argcount + code.co_kwonlyargcount]),
                "locals": {name: _value(value) for name, value in local_items},
            })
        last_line = frame.f_lineno
        step = {"event": event, "line": last_line, "frames": frames}
        if event == "return":
            # CPython also emits 'return' while unwinding an uncaught error.
            # Distinguish it from a real 'return None', including try/finally.
            opcode = dis.opname[frame.f_code.co_code[frame.f_lasti]]
            if opcode in ("RETURN_VALUE", "RETURN_CONST"):
                step["value"] = _value(arg)
            else:
                step["event"] = "unwind"
                step["message"] = frame_errors.get(id(frame), "Function exited with an exception.")
        elif event == "exception":
            step["message"] = f"{arg[0].__name__}: {str(arg[1])[:1_000]}"
            frame_errors[id(frame)] = step["message"]
        payload = json.dumps(step, allow_nan=False, separators=(',', ':'))
        size = len(payload.encode('utf-8'))
        if byte_count + size > max_bytes:
            raise TraceLimit(f"Trace-memory limit reached ({max_bytes / 1024**2:g} MiB).")
        count += 1
        byte_count += size
        emit(payload)
        if event == "return":
            frame_ids.pop(id(frame), None)
            frame_errors.pop(id(frame), None)
        return trace

    try:
        tree = _parse(source)
        if entry not in [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]:
            raise ValueError("Select a function defined in the pasted code.")
        safe_builtins = vars(builtins).copy()
        safe_builtins.update({name: _unsupported for name in ("input", "open", "exec", "eval", "compile", "breakpoint")})
        safe_builtins['__import__'] = _import
        namespace = {"__builtins__": safe_builtins, "__name__": "__visualizer__"}
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            exec(compile(tree, FILENAME, 'exec', flags=__future__.annotations.compiler_flag), namespace)
            function = namespace[entry]
            args, kwargs = _arguments(function, raw_inputs)
            sys.settrace(trace)
            try:
                result = function(*args, **kwargs)
            finally:
                sys.settrace(None)
            outcome['result'] = _value(result)
    except TraceLimit as error:
        outcome = {"status": "limited", "message": str(error), "line": last_line}
    except BaseException as error:
        line = getattr(error, 'lineno', None)
        tb = error.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_filename == FILENAME:
                line = tb.tb_lineno
            tb = tb.tb_next
        outcome = {"status": "error", "message": f"{type(error).__name__}: {str(error)[:1_000]}", "line": line}
    finally:
        sys.settrace(None)
    outcome['output'] = output.getvalue()
    outcome['elapsedMs'] = round((time.perf_counter() - started) * 1_000)
    return outcome
