import os
import subprocess


def execute_tool(name, params, workspace):
    try:
        if name == "bash":
            result = subprocess.run(
                params["command"],
                shell=True,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return (
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}\n"
                f"Exit code: {result.returncode}"
            )

        if name == "read_file":
            path = os.path.join(workspace, params["path"])
            with open(path, "r", encoding="utf-8") as file:
                return file.read()

        if name == "write_file":
            path = os.path.join(workspace, params["path"])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as file:
                file.write(params["content"])
            return "File written successfully"

        return "Unknown tool"

    except Exception as error:
        return f"Error: {str(error)}"
