import argparse
import subprocess
import time


def run_batch(provider, models, runs_per_model, pause_seconds, prompt_variant="strict"):
    total = len(models) * runs_per_model
    current = 0
    for model in models:
        for run_idx in range(1, runs_per_model + 1):
            current += 1
            print(f"[{current}/{total}] Running model={model} trial={run_idx}/{runs_per_model}")
            cmd = [
                "python",
                "execution/run_agent.py",
                provider,
                model,
                "--prompt",
                prompt_variant,
            ]
            result = subprocess.run(
                cmd,
                check=False,
                text=True,
                capture_output=True,
            )
            if result.returncode != 0:
                print(result.stdout)
                print(result.stderr)
                raise RuntimeError(f"Run failed for model={model} trial={run_idx}")
            if pause_seconds > 0:
                time.sleep(pause_seconds)
    print("Batch run complete.")


def main():
    parser = argparse.ArgumentParser(
        description="Run dependency hallucination task multiple times per model."
    )
    parser.add_argument(
        "--provider",
        choices=["anthropic", "nvidia"],
        default="anthropic",
        help="LLM provider to use (default: anthropic).",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=["claude-sonnet-4-20250514"],
        help="Space-separated model IDs to run.",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=20,
        help="Number of runs per model (default: 20).",
    )
    parser.add_argument(
        "--pause",
        type=int,
        default=3,
        help="Seconds to wait between runs (default: 3).",
    )
    parser.add_argument(
        "--prompt",
        choices=["strict", "minimal"],
        default="strict",
        help="Task prompt variant: strict (default) or minimal (no verify-before-install text).",
    )
    args = parser.parse_args()
    run_batch(args.provider, args.models, args.runs, args.pause, args.prompt)


if __name__ == "__main__":
    main()
