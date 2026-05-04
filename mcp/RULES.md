[English](RULES.md) | [中文](docs/RULES_zh.md)

# Task Execution and Environment Management Rules

## 1. Task Initialization Protocol (Highest Priority)

- **Read Skills**: When starting a new task or triggering any skill, you **MUST** immediately read and execute `SKILL.md` in the auto-skill directory.
- **Check Progress**: Upon starting a conversation, you **MUST** first read `user-recent-working-on/now/working-on.md` to understand the user's current work, ensuring context consistency.
- **Environment Pre-check**: Before executing any code or installing packages, check the current directory's environment status to ensure isolation principles are met.

## 2. Python Environment Management (Forced to use uv)

If you find missing Python packages during execution, follow these steps. **ABSOLUTELY NO** direct global installations on the host machine:

1. **Check Environment**: Ensure a virtual environment (`.venv` folder) exists in the current directory.
2. **Create Environment**: If it doesn't exist, execute `uv venv` to create one.
3. **Activate Environment**: Execute `source .venv/bin/activate` (use `.venv\Scripts\activate` on Windows).
4. **Install Packages**: Use `uv pip install <package_name>` for installation.
5. **Quick Execution**: For single-script runs, consider directly using `uv run <script.py>` so uv handles dependencies automatically.

## 3. Node.js Environment Management (Forced in-project isolation)

If you find missing Node.js packages during execution, follow these steps. **ABSOLUTELY NO** direct global installations:

1. **Check Project Settings**: Check if `package.json` exists in the current directory.
2. **Create Project**: If `package.json` doesn't exist, execute `npm init -y` to create it.
3. **Install Packages**: Use `npm install <package>` to install, ensuring it is written to `package.json` and placed in the project's `node_modules`.
4. **Dev Dependencies**: For dev or test tools, use `npm install -D <package>`.
5. **Run Scripts**: Prioritize using `npm run <script>` to execute project scripts.
6. **One-off Execution**: For one-off tools or scripts, prioritize using `npx <command>` to avoid global installations.
7. **Keep Updated**: After installation, update `package.json` and lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) as needed.

Additional rules also apply:

- **No Global Operations**: `npm install -g`, `yarn global add`, or `pnpm add -g` are strictly prohibited unless explicitly requested by the user.
- **Consistency First**: If the project already uses `npm`, `yarn`, or `pnpm`, continue using that specific tool. Do not mix them.

## 4. Other Language Environment Management

Non-Python projects must also follow the "in-project isolation" principle:

- **Node.js**: 
  - If no `package.json`, execute `npm init -y`.
  - Use `npm install <package>`, ensuring packages are installed in the local `node_modules`.
- **Rust**: Use `cargo add <crate>`, ensuring dependencies are recorded in `Cargo.toml`.
- **Go**: Use `go mod init` (if none exists) alongside `go get <module>`.

## 5. Execution Guidelines and Auto-Recovery

- **No Global Operations**: `sudo pip install` or installing packages without an activated virtual environment are strictly prohibited.
- **Self-Healing**: If `ModuleNotFoundError` or `Command not found` occurs during code execution, automatically determine the environment based on the protocols above, create a virtual environment, and install missing packages. If unsure, ask the user first.
- **Keep Updated**: After installation, update the project's dependency list (`pyproject.toml`, `requirements.txt`, or `package.json`) as needed.
