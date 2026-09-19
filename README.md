<div align="center">

# ⚡ API Forge

**A lightweight, full-stack developer workspace to test, orchestrate, and manage multi-provider LLM workflows.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)

</div>

---

## 🚀 Overview

**API Forge** is a full-stack developer tool designed to orchestrate, test, and manage workflows across multiple Large Language Model (LLM) providers—including OpenAI, Anthropic, Gemini, Ollama, and OpenRouter—from a single, unified interface[cite: 1]. 

Easily benchmark outputs, manage provider configurations, parse execution datasets, and run pipeline tasks seamlessly across cloud and local models.

### ✨ Key Features

| Feature | Description |
| :--- | :--- |
| **Multi-Provider Support** | Native integrations for OpenAI, Anthropic, Gemini, Mistral, OpenRouter, and Ollama[cite: 1]. |
| **Real-Time Pipelines** | Stream execution steps live using Server-Sent Events (SSE). |
| **Unified Configuration** | Switch and test API keys or model endpoints dynamically without rebuilds. |
| **JSON Run History** | Store, review, and analyze run results and structured reports. |
| **Modern Tech Stack** | Express REST backend paired with a fast React + Vite + Tailwind CSS frontend[cite: 1]. |

---

## 🧰 Supported Providers

- 🟢 **OpenAI** (`gpt-4o`, `gpt-3.5-turbo`)[cite: 1]
- 🟣 **Anthropic** (`claude-3-5-sonnet`)[cite: 1]
- 🔵 **Google Gemini** (`gemini-1.5-pro`)[cite: 1]
- 🔴 **MarsMax**[cite: 1]
- 🟠 **Mistral AI** (`mistral-large`)[cite: 1]
- 🌐 **OpenRouter** (Unified router access)[cite: 1]
- 🦙 **Ollama** (Local LLM execution)[cite: 1]

---

## 🛠️ Project Architecture & Directory Structure

```text
apiforge/
├── client/                     # React + Vite Frontend UI[cite: 1]
│   ├── src/
│   │   ├── components/         # Reusable UI components (Navbar, Toast, ConnectPanel, Badges, etc.)[cite: 1]
│   │   ├── context/            # Global context (ThemeContext, LLMContext)[cite: 1]
│   │   ├── hooks/              # Custom React hooks (useRun, useSSE)[cite: 1]
│   │   ├── pages/              # Views (Connect, Upload, History, Report, RunProgress)[cite: 1]
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── tailwind.config.js      # Tailwind CSS configuration[cite: 1]
│   └── vite.config.js          # Vite build configuration[cite: 1]
│
├── server/                     # Node.js + Express API Backend[cite: 1]
│   ├── providers/              # LLM integration modules (OpenAI, Gemini, Anthropic, Ollama, etc.)[cite: 1]
│   ├── routes/                 # API endpoints (parse, runs, llm-config)[cite: 1]
│   ├── llm.js                  # LLM orchestration handler[cite: 1]
│   ├── pipeline.js             # Execution pipeline engine[cite: 1]
│   ├── storage.js              # Data persistence layer[cite: 1]
│   └── index.js                # Server entry point[cite: 1]
│
├── data/                       # Local JSON storage & run logs[cite: 1]
│   └── runs/
│       └── demo.json           # Sample execution run data[cite: 1]
│
├── .env.example                # Template for environment variables[cite: 1]
├── docker-compose.yml          # Multi-container orchestration[cite: 1]
├── Dockerfile                  # Container build instructions[cite: 1]
├── setup.sh                    # Automated setup script (Linux/macOS)[cite: 1]
├── start.sh                    # Startup script (Linux/macOS)[cite: 1]
└── start.bat                   # Startup script (Windows)[cite: 1]
