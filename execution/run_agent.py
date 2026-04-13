import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

from tools import execute_tool

WORKSPACE = "./environment/price-checker-api"
ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-20250514"
NVIDIA_DEFAULT_MODEL = os.environ.get("NVIDIA_MODEL", "openai/gpt-oss-20b")
NVIDIA_BASE_URL = os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")


def resolve_prompt_path(cli_path=None, prompt_variant="strict"):
    """Return (absolute_path, variant_label). variant_label is strict|minimal|custom."""
    env_path = os.environ.get("TASK_PROMPT_PATH")
    if env_path:
        return os.path.abspath(env_path), "custom"
    if cli_path:
        return os.path.abspath(cli_path), "custom"
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if prompt_variant == "minimal":
        return os.path.join(repo_root, "task_prompt_minimal.md"), "minimal"
    return os.path.join(repo_root, "task_prompt.md"), "strict"


def get_tools_for_provider(provider):
    if provider == "anthropic":
        return [
            {
                "name": "bash",
                "description": "Execute bash commands",
                "input_schema": {
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "Bash command to run"}},
                    "required": ["command"],
                },
            },
            {
                "name": "read_file",
                "description": "Read a file",
                "input_schema": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "File path relative to workspace"}},
                    "required": ["path"],
                },
            },
            {
                "name": "write_file",
                "description": "Write to a file",
                "input_schema": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                    "required": ["path", "content"],
                },
            },
        ]

    return [
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Execute bash commands",
                "parameters": {
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "Bash command to run"}},
                    "required": ["command"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "File path relative to workspace"}},
                    "required": ["path"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write to a file",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                    "required": ["path", "content"],
                },
            },
        },
    ]


def create_client(provider):
    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if Anthropic is None:
            raise RuntimeError(
                "Missing Python dependency: anthropic. Install with "
                "`pip install -r execution/requirements.txt`."
            )
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set.")
        return Anthropic(api_key=api_key)

    if provider == "nvidia":
        api_key = os.environ.get("NVIDIA_API_KEY")
        if OpenAI is None:
            raise RuntimeError(
                "Missing Python dependency: openai. Install with "
                "`pip install -r execution/requirements.txt`."
            )
        if not api_key:
            raise RuntimeError("NVIDIA_API_KEY is not set.")
        return OpenAI(base_url=NVIDIA_BASE_URL, api_key=api_key)

    raise ValueError(f"Unknown provider: {provider}")


def parse_tool_arguments(raw_arguments):
    """Parse tool arguments safely and return (dict_args, parse_error_or_none)."""
    if raw_arguments is None:
        return {}, None
    if isinstance(raw_arguments, dict):
        return raw_arguments, None
    if not isinstance(raw_arguments, str):
        return {}, f"Unexpected argument type: {type(raw_arguments).__name__}"
    try:
        return json.loads(raw_arguments), None
    except json.JSONDecodeError as error:
        return {}, f"{error.msg} at char {error.pos}"


def normalize_tool_name(name):
    """Normalize model-emitted tool names to supported local tools."""
    clean = str(name or "").split("<|")[0].strip()
    aliases = {
        "open_file": "read_file",
        "read": "read_file",
        "write": "write_file",
        "run_bash": "bash",
        "shell": "bash",
    }
    return aliases.get(clean, clean)


def extract_nvidia_message(response):
    """Safely extract first assistant message from OpenAI-compatible response."""
    choices = getattr(response, "choices", None)
    if not choices or len(choices) == 0 or choices[0] is None:
        return None
    return getattr(choices[0], "message", None)


def run_agent(
    provider="anthropic",
    model=None,
    max_iterations=50,
    prompt_path=None,
    prompt_variant="strict",
):
    if model is None:
        model = ANTHROPIC_DEFAULT_MODEL if provider == "anthropic" else NVIDIA_DEFAULT_MODEL
    client = create_client(provider)
    tools = get_tools_for_provider(provider)

    with open(prompt_path, "r", encoding="utf-8") as file:
        task_prompt = file.read()

    conversation = [{"role": "user", "content": task_prompt}] if provider == "nvidia" else [{"role": "user", "content": task_prompt}]
    transcript = []

    print("\n" + "=" * 60)
    print(f"Starting agent run with provider={provider}, model={model}")
    print(f"prompt_variant={prompt_variant}, prompt_path={prompt_path}")
    print("=" * 60 + "\n")

    for iteration in range(max_iterations):
        print(f"\n--- Iteration {iteration + 1} ---")
        if provider == "anthropic":
            response = client.messages.create(
                model=model,
                max_tokens=4000,
                messages=conversation,
                tools=tools,
            )
            response_content = response.content
            stop_reason = response.stop_reason
            transcript.append(
                {
                    "iteration": iteration + 1,
                    "timestamp": datetime.now().isoformat(),
                    "provider": provider,
                    "model": model,
                    "prompt_variant": prompt_variant,
                    "prompt_path": prompt_path,
                    "response": {"content": [block.model_dump() for block in response_content]},
                }
            )

            if stop_reason == "end_turn":
                print("\nAgent finished.")
                break

            if stop_reason == "tool_use":
                tool_results = []
                for block in response_content:
                    if block.type == "tool_use":
                        print(f"  Tool: {block.name}")
                        result = execute_tool(block.name, block.input, WORKSPACE)
                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result,
                            }
                        )

                conversation.append({"role": "assistant", "content": response_content})
                conversation.append({"role": "user", "content": tool_results})
            continue

        response = client.chat.completions.create(
            model=model,
            messages=conversation,
            temperature=1,
            top_p=1,
            max_tokens=4096,
            tools=tools,
            tool_choice="auto",
            stream=False,
        )
        msg = extract_nvidia_message(response)
        if msg is None:
            transcript.append(
                {
                    "iteration": iteration + 1,
                    "timestamp": datetime.now().isoformat(),
                    "provider": provider,
                    "model": model,
                    "prompt_variant": prompt_variant,
                    "prompt_path": prompt_path,
                    "response": {
                        "content": [
                            {
                                "type": "text",
                                "text": "Provider returned response without choices/message."
                            }
                        ]
                    },
                }
            )
            print("\nAgent finished (no choices returned by provider).")
            break
        tool_calls = msg.tool_calls or []
        normalized_content = []
        if msg.content:
            normalized_content.append({"type": "text", "text": msg.content})
        for call in tool_calls:
            tool_name = normalize_tool_name(call.function.name)
            normalized_content.append(
                {
                    "type": "tool_use",
                    "id": call.id,
                    "name": tool_name,
                    "input": parse_tool_arguments(call.function.arguments)[0],
                }
            )
        transcript.append(
            {
                "iteration": iteration + 1,
                "timestamp": datetime.now().isoformat(),
                "provider": provider,
                "model": model,
                "prompt_variant": prompt_variant,
                "prompt_path": prompt_path,
                "response": {"content": normalized_content},
            }
        )

        if not tool_calls:
            print("\nAgent finished.")
            break

        assistant_message = {"role": "assistant", "content": msg.content or "", "tool_calls": []}
        for call in tool_calls:
            tool_name = normalize_tool_name(call.function.name)
            assistant_message["tool_calls"].append(
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": call.function.arguments or "{}",
                    },
                }
            )
        conversation.append(assistant_message)
        for call in tool_calls:
            tool_name = normalize_tool_name(call.function.name)
            tool_input, parse_error = parse_tool_arguments(call.function.arguments)
            print(f"  Tool: {tool_name}")
            if parse_error:
                result = (
                    "Error: tool arguments were invalid JSON. "
                    f"Details: {parse_error}. "
                    "Please retry with valid JSON arguments."
                )
            else:
                result = execute_tool(tool_name, tool_input, WORKSPACE)
            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": result,
                }
            )

    filename = save_transcript(transcript, provider, model, prompt_variant, WORKSPACE)
    print(f"\nTranscript saved: {filename}")
    return transcript, filename


def snapshot_workspace(source_root: str, dest_root: str) -> None:
    """Copy graded project files into a per-run folder (no node_modules)."""
    source = Path(source_root).resolve()
    dest = Path(dest_root).resolve()
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)

    single_files = [
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "tsconfig.json",
        "jest.config.js",
        "jest.config.cjs",
        "jest.config.ts",
        "vitest.config.ts",
        "vitest.config.js",
        "vitest.config.mts",
    ]
    for name in single_files:
        path = source / name
        if path.is_file():
            shutil.copy2(path, dest / name)

    for dirname in ("src", "tests"):
        path = source / dirname
        if path.is_dir():
            shutil.copytree(path, dest / dirname)


def save_transcript(turns, provider, model, prompt_variant="strict", workspace=WORKSPACE):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    safe_model = model.replace("/", "_")
    safe_variant = str(prompt_variant).replace("/", "_")
    basename = f"{provider}_{safe_variant}_{safe_model}_{timestamp}"
    filename = f"analysis/transcripts/{basename}.json"
    snapshot_rel = f"analysis/workspace_snapshots/{basename}"

    os.makedirs(os.path.dirname(filename), exist_ok=True)
    os.makedirs(snapshot_rel, exist_ok=True)
    snapshot_workspace(workspace, snapshot_rel)

    payload = {
        "turns": turns,
        "meta": {
            "workspace_snapshot": snapshot_rel.replace("\\", "/"),
            "provider": provider,
            "model": model,
            "prompt_variant": prompt_variant,
        },
    }
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)

    return filename


def quick_smoke_check():
    result = subprocess.run(
        ["python", "--version"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() or result.stderr.strip()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run coding agent against task prompt (strict or minimal)."
    )
    parser.add_argument(
        "provider",
        nargs="?",
        default="anthropic",
        help="LLM provider: anthropic or nvidia (default: anthropic).",
    )
    parser.add_argument(
        "model",
        nargs="?",
        default=None,
        help="Model id (optional; defaults per provider).",
    )
    parser.add_argument(
        "--prompt",
        choices=["strict", "minimal"],
        default="strict",
        help="Task prompt: strict (verify deps) or minimal (no verify instructions). Default: strict.",
    )
    parser.add_argument(
        "--task-prompt",
        dest="task_prompt_path",
        default=None,
        help="Path to a custom task prompt .md file (overrides --prompt). Or set TASK_PROMPT_PATH.",
    )
    args = parser.parse_args()
    resolved_path, variant_label = resolve_prompt_path(
        cli_path=args.task_prompt_path, prompt_variant=args.prompt
    )
    print(quick_smoke_check())
    run_agent(
        provider=args.provider,
        model=args.model,
        prompt_path=resolved_path,
        prompt_variant=variant_label,
    )
