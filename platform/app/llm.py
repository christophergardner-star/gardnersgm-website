"""
GGM Hub — LLM Provider (Auto-Detect)
Automatically finds the best available LLM and provides a unified interface.

Detection priority:
  1. Ollama (local, free — preferred for privacy)
  2. OpenAI-compatible APIs (LM Studio, text-generation-webui, etc.)
  3. OpenAI GPT (cloud, requires API key)
  4. Google Gemini (cloud, free tier available)
  5. Fallback to built-in templates (no AI)

All generation goes through  llm.generate()  — the rest of the Hub never
needs to know which provider is active.
"""

import json
import logging
import os
import requests
from dataclasses import dataclass
from typing import Optional

from . import config

log = logging.getLogger("ggm.llm")

# ──────────────────────────────────────────────────────────────────
# Provider definitions
# ──────────────────────────────────────────────────────────────────

@dataclass
class LLMProvider:
    name: str
    model: str
    endpoint: str
    api_key: str = ""
    provider_type: str = ""  # ollama | openai | gemini | none

    def label(self) -> str:
        return f"{self.name} ({self.model})"


# Singleton — set after detection
_active_provider: Optional[LLMProvider] = None


# ──────────────────────────────────────────────────────────────────
# Detection
# ──────────────────────────────────────────────────────────────────

def _probe_ollama() -> Optional[LLMProvider]:
    """Check local Ollama instance for available models."""
    url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    preferred = os.getenv("OLLAMA_MODEL", "")

    try:
        resp = requests.get(f"{url}/api/tags", timeout=5)
        if resp.status_code != 200:
            return None
        models = resp.json().get("models", [])
        if not models:
            return None

        # Build list of model names
        names = [m.get("name", "") for m in models]
        log.info(f"Ollama models found: {', '.join(names)}")

        # Pick the best model
        chosen = _pick_best_ollama_model(names, preferred)
        if not chosen:
            return None

        return LLMProvider(
            name="Ollama",
            model=chosen,
            endpoint=url,
            provider_type="ollama",
        )
    except Exception:
        return None


def _pick_best_ollama_model(available: list[str], preferred: str = "") -> str:
    """Pick the best Ollama model from what's installed."""
    if not available:
        return ""

    # If user set a preference and it's available, use it
    if preferred:
        for m in available:
            if preferred.lower() in m.lower():
                return m

    # Ranked preferences (best writing quality first)
    ranked = [
        "llama3.1", "llama3.2", "llama3", "llama3:8b",
        "mistral", "mistral:7b", "mixtral",
        "gemma2", "gemma:7b", "gemma",
        "phi3", "phi",
        "qwen2", "qwen",
        "deepseek-coder",
        "codellama",
    ]

    for pref in ranked:
        for m in available:
            if pref in m.lower():
                return m

    # Just use the first available model
    return available[0]


def _probe_openai() -> Optional[LLMProvider]:
    """Check for OpenAI API key or compatible local server."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Check for local OpenAI-compatible server (LM Studio, etc.)
    local_urls = [
        "http://localhost:1234/v1",  # LM Studio
        "http://localhost:5000/v1",  # text-generation-webui
        "http://localhost:8080/v1",  # llama.cpp server
    ]

    for local_url in local_urls:
        try:
            resp = requests.get(f"{local_url}/models", timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                models = data.get("data", [])
                if models:
                    local_model = models[0].get("id", "local-model")
                    return LLMProvider(
                        name="Local OpenAI-compatible",
                        model=local_model,
                        endpoint=local_url,
                        provider_type="openai",
                    )
        except Exception:
            continue

    # Cloud OpenAI
    if api_key:
        try:
            resp = requests.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            if resp.status_code == 200:
                return LLMProvider(
                    name="OpenAI",
                    model=model,
                    endpoint=base_url,
                    api_key=api_key,
                    provider_type="openai",
                )
        except Exception:
            pass

    return None


def _probe_gemini() -> Optional[LLMProvider]:
    """Check for Google Gemini API key."""
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

    if not api_key:
        return None

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return LLMProvider(
                name="Google Gemini",
                model=model,
                endpoint="https://generativelanguage.googleapis.com/v1beta",
                api_key=api_key,
                provider_type="gemini",
            )
    except Exception:
        pass

    return None


def detect_provider(force_refresh: bool = False) -> LLMProvider:
    """
    Auto-detect the best available LLM provider.
    Caches the result — call with force_refresh=True to re-probe.
    """
    global _active_provider

    if _active_provider and not force_refresh:
        return _active_provider

    log.info("Auto-detecting LLM provider...")

    # Priority order
    for name, probe_fn in [
        ("Ollama", _probe_ollama),
        ("OpenAI-compatible", _probe_openai),
        ("Google Gemini", _probe_gemini),
    ]:
        provider = probe_fn()
        if provider:
            log.info(f"✅ LLM provider: {provider.label()}")
            _active_provider = provider
            return provider

    # No AI available — use template fallback
    log.warning("⚠️ No LLM available — using template fallback")
    _active_provider = LLMProvider(
        name="Templates Only",
        model="none",
        endpoint="",
        provider_type="none",
    )
    return _active_provider


# ──────────────────────────────────────────────────────────────────
# Unified generation
# ──────────────────────────────────────────────────────────────────

def generate(
    prompt: str,
    system: str = "",
    max_tokens: int = 2000,
    temperature: float = 0.7,
    json_mode: bool = False,
) -> str:
    """
    Generate text using whichever LLM is available.
    Returns the generated text or an error string starting with [Error:...].
    """
    provider = detect_provider()

    if provider.provider_type == "none":
        return "[Error: No LLM available — install Ollama or set an API key]"

    try:
        if provider.provider_type == "ollama":
            return _generate_ollama(provider, prompt, system, max_tokens, temperature)
        elif provider.provider_type == "openai":
            return _generate_openai(provider, prompt, system, max_tokens, temperature, json_mode)
        elif provider.provider_type == "gemini":
            return _generate_gemini(provider, prompt, system, max_tokens, temperature)
        else:
            return "[Error: Unknown provider type]"
    except Exception as e:
        log.error(f"LLM generation error: {e}")
        return f"[Error: {e}]"


def _generate_ollama(
    provider: LLMProvider, prompt: str, system: str,
    max_tokens: int, temperature: float
) -> str:
    """Generate via Ollama REST API.
    
    Uses num_ctx=4096 for reliable context window on 8B models.
    Ollama will auto-use GPU VRAM if available, falling back to CPU.
    No num_gpu restriction — let Ollama decide based on available VRAM.
    """
    payload = {
        "model": provider.model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_predict": max_tokens,
            "temperature": temperature,
            "num_ctx": 4096,       # context window — safe for 4GB VRAM
            "repeat_penalty": 1.1, # reduce repetitive output
            "top_p": 0.9,          # nucleus sampling for coherence
        },
    }
    if system:
        payload["system"] = system

    resp = requests.post(
        f"{provider.endpoint}/api/generate",
        json=payload,
        timeout=300,  # allow up to 5 min for CPU-bound generation
    )
    resp.raise_for_status()
    return resp.json().get("response", "").strip()


def _generate_openai(
    provider: LLMProvider, prompt: str, system: str,
    max_tokens: int, temperature: float, json_mode: bool
) -> str:
    """Generate via OpenAI-compatible API."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": provider.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    headers = {"Content-Type": "application/json"}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {provider.api_key}"

    resp = requests.post(
        f"{provider.endpoint}/chat/completions",
        json=payload,
        headers=headers,
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


def _generate_gemini(
    provider: LLMProvider, prompt: str, system: str,
    max_tokens: int, temperature: float
) -> str:
    """Generate via Google Gemini API."""
    url = (
        f"{provider.endpoint}/models/{provider.model}:generateContent"
        f"?key={provider.api_key}"
    )

    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": f"System instructions: {system}"}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I'll follow those instructions."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload = {
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
        },
    }

    resp = requests.post(url, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    candidates = data.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts).strip()
    return "[Error: Gemini returned empty response]"


# ──────────────────────────────────────────────────────────────────
# Convenience helpers
# ──────────────────────────────────────────────────────────────────

def get_status() -> dict:
    """Return current LLM status for the UI."""
    provider = detect_provider()
    return {
        "available": provider.provider_type != "none",
        "provider": provider.name,
        "model": provider.model,
        "label": provider.label(),
        "type": provider.provider_type,
    }


def is_available() -> bool:
    """Quick check if any LLM is available."""
    return detect_provider().provider_type != "none"


def refresh():
    """Force re-detection of LLM provider."""
    global _active_provider
    _active_provider = None
    return detect_provider(force_refresh=True)
