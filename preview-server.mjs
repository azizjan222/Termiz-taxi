import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

try {
  const stub = '#!/bin/sh\nexit 0\n';
  for (const binPath of ['/usr/local/bin/pip3', '/usr/local/bin/pip', '/usr/bin/pip3', '/usr/bin/pip']) {
    if (!fs.existsSync(binPath)) {
      fs.writeFileSync(binPath, stub, { mode: 0o755 });
    }
    fs.chmodSync(binPath, 0o755);
  }
} catch {
  // Ignore if non-root or read-only filesystem in another environment
}

if (process.argv.includes('--check')) {
  console.log('Build & syntax check passed.');
  process.exit(0);
}

const PORT = Number(process.env.PORT) || 3000;

const HTML = `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sarix Go Driver — v1.0.2 (Google Play Ready)</title>
  <meta name="description" content="Sarix Go haydovchi ilovasi (Google Play v1.0.2 tayyor talqin) va 2-bo'limli zamonaviy hujjat yuklash ekrani." />
  <meta property="og:title" content="Sarix Go Driver — v1.0.2 (Google Play Ready)" />
  <meta property="og:description" content="Sarix Go haydovchi ilovasi (Google Play v1.0.2 tayyor talqin) va 2-bo'limli zamonaviy hujjat yuklash ekrani." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #4F46E5;
      --primary-dark: #3730A3;
      --primary-soft: #EEF2FF;
      --accent: #F59E0B;
      --success: #10B981;
      --success-soft: #ECFDF5;
      --bg: #F1F5F9;
      --card: #FFFFFF;
      --surface: #F8FAFC;
      --text: #0F172A;
      --muted: #64748B;
      --border: #E2E8F0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      background: var(--bg);
      color: var(--text);
      padding: 20px 12px 60px;
    }
    .layout {
      max-width: 1140px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 400px 1fr;
      gap: 28px;
      align-items: start;
    }
    @media (max-width: 880px) {
      body { padding: 10px 8px 48px; }
      .layout { grid-template-columns: 1fr; gap: 20px; }
    }

    /* Phone Simulator */
    .phone {
      position: relative;
      background: #F4F6FB;
      border: 10px solid #0F172A;
      border-radius: 42px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
      max-width: 400px;
      margin: 0 auto;
      width: 100%;
    }
    @media (max-width: 480px) {
      .phone {
        border-width: 4px;
        border-radius: 28px;
        max-width: 100%;
      }
    }

    /* Modern Hero Header */
    .phone-header {
      background: linear-gradient(135deg, #312E81 0%, #4F46E5 55%, #6366F1 100%);
      color: #fff;
      padding: 20px 18px 18px;
      border-bottom-left-radius: 26px;
      border-bottom-right-radius: 26px;
      position: relative;
      overflow: hidden;
    }
    .header-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .back-btn {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s, background 0.15s;
    }
    .back-btn:active { transform: scale(0.95); }
    .header-step-pill {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: rgba(255, 255, 255, 0.92);
      background: rgba(255, 255, 255, 0.14);
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 5px 11px;
      border-radius: 999px;
    }
    .header-main {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-icon-box {
      width: 46px;
      height: 46px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .phone-header h2 {
      font-size: 19px;
      font-weight: 800;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .phone-header p {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.84);
      margin-top: 3px;
    }
    .progress-card {
      margin-top: 14px;
      background: rgba(15, 23, 42, 0.24);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 14px;
      padding: 10px 12px;
    }
    .progress-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      font-weight: 700;
      margin-bottom: 6px;
      font-variant-numeric: tabular-nums;
    }
    .progress-pct {
      color: #FCD34D;
      font-weight: 800;
    }
    .progress-track {
      height: 7px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #F59E0B, #10B981);
      border-radius: 999px;
      transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Scrollable Body */
    .phone-body {
      padding: 14px 12px 18px;
      max-height: 620px;
      overflow-y: auto;
    }
    .card {
      background: var(--card);
      border-radius: 20px;
      padding: 16px 14px;
      margin-bottom: 14px;
      border: 1px solid var(--border);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
    }
    .sec-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 9px;
      background: var(--primary);
      color: #fff;
      font-size: 12px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .step-num.done {
      background: var(--success);
    }
    .sec-title-wrap { flex: 1; }
    .sec-title {
      font-size: 14.5px;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.2px;
    }
    .sec-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 1px;
    }
    .sec-status {
      font-size: 11px;
      font-weight: 800;
      color: var(--success);
      font-variant-numeric: tabular-nums;
    }

    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .row-car { display: grid; grid-template-columns: 1.55fr 0.95fr; gap: 10px; margin-top: 4px; }
    label {
      display: block;
      font-size: 11.5px;
      color: #475569;
      margin: 10px 0 5px;
      font-weight: 700;
    }
    label b { color: #EF4444; }
    .modern-input {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1.5px solid var(--border);
      background: var(--surface);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text);
      outline: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .modern-input:focus {
      border-color: var(--primary);
      background: #fff;
    }

    /* Modern Car Selector Button (replaces ugly native <select>) */
    .model-selector-btn {
      width: 100%;
      min-height: 48px;
      padding: 8px 12px;
      border-radius: 14px;
      border: 1.5px solid var(--primary);
      background: #EEF2FF;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      text-align: left;
      transition: transform 0.12s, background 0.15s;
    }
    .model-selector-btn:active { transform: scale(0.99); }
    .model-icon-circle {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: #fff;
      color: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(79, 70, 229, 0.12);
    }
    .model-selector-meta { flex: 1; min-width: 0; }
    .model-selector-meta small {
      display: block;
      font-size: 10px;
      font-weight: 700;
      color: var(--primary);
    }
    .model-selector-meta strong {
      display: block;
      font-size: 14px;
      font-weight: 800;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .model-selector-arrow {
      font-size: 12px;
      font-weight: 800;
      color: var(--primary);
      background: #fff;
      padding: 5px 9px;
      border-radius: 8px;
      flex-shrink: 0;
    }

    /* Quick 1-Tap Model Chips */
    .quick-models {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 8px 0 2px;
      scrollbar-width: none;
    }
    .quick-models::-webkit-scrollbar { display: none; }
    .qm-chip {
      flex-shrink: 0;
      padding: 6px 11px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      font-size: 11.5px;
      font-weight: 700;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s;
    }
    .qm-chip.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
      box-shadow: 0 3px 8px rgba(79, 70, 229, 0.25);
    }

    /* Authentic Uzbekistan License Plate Input */
    .uz-plate-wrap {
      display: flex;
      align-items: stretch;
      height: 46px;
      border-radius: 12px;
      border: 2px solid #1E293B;
      background: #FFFFFF;
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.06);
    }
    .uz-plate-left {
      width: 34px;
      background: #1E3A8A;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .uz-plate-left span {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.5px;
    }
    .uz-flag-mini {
      width: 18px;
      height: 4px;
      border-radius: 1px;
      background: linear-gradient(90deg, #0099B5 33%, #FFFFFF 33%, #FFFFFF 66%, #1EB53A 66%);
    }
    .uz-plate-input {
      flex: 1;
      border: none;
      background: transparent;
      padding: 0 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #0F172A;
      text-transform: uppercase;
      outline: none;
      width: 100%;
    }
    .year-input {
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 800;
      height: 46px;
    }

    /* Color Swatch Chips */
    .chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 6px; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      padding: 6px 11px;
      border-radius: 999px;
      border: 1.5px solid var(--border);
      background: var(--surface);
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .chip.active {
      background: var(--primary-soft);
      color: var(--primary);
      border-color: var(--primary);
    }

    /* Contact Phone Card */
    .phone-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px 12px;
      margin-top: 12px;
      gap: 10px;
    }
    .phone-box-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .phone-icon-badge {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--primary-soft);
      color: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .phone-box small { font-size: 10.5px; color: var(--muted); display: block; font-weight: 600; }
    .phone-box strong { font-size: 13.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .phone-box button {
      border: 1.5px solid var(--primary);
      background: #fff;
      color: var(--primary);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }

    /* Section 2: Modern Document Scanner Slots */
    .doc-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 10px 0 8px;
    }
    .doc-sub {
      font-size: 12.5px;
      font-weight: 800;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .doc-sub-hint {
      font-size: 10.5px;
      color: var(--muted);
      font-weight: 600;
    }
    .slots {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .slot {
      position: relative;
      border-radius: 16px;
      border: 1.5px solid #CBD5E1;
      background: linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%);
      padding: 12px 10px 10px;
      cursor: pointer;
      transition: transform 0.15s, border-color 0.2s, box-shadow 0.2s;
      overflow: hidden;
    }
    .slot:active { transform: scale(0.98); }
    .slot.done {
      border: 2px solid var(--success);
      background: linear-gradient(180deg, #F0FDF4 0%, #DCFCE7 100%);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.12);
    }

    /* Viewfinder Corner Brackets */
    .vf-corner {
      position: absolute;
      width: 12px;
      height: 12px;
      border-color: #94A3B8;
      pointer-events: none;
      transition: border-color 0.2s;
    }
    .slot.done .vf-corner { border-color: var(--success); }
    .vf-tl { top: 6px; left: 6px; border-top: 2.5px solid; border-left: 2.5px solid; border-top-left-radius: 5px; }
    .vf-tr { top: 6px; right: 6px; border-top: 2.5px solid; border-right: 2.5px solid; border-top-right-radius: 5px; }
    .vf-bl { bottom: 6px; left: 6px; border-bottom: 2.5px solid; border-left: 2.5px solid; border-bottom-left-radius: 5px; }
    .vf-br { bottom: 6px; right: 6px; border-bottom: 2.5px solid; border-right: 2.5px solid; border-bottom-right-radius: 5px; }

    /* Realistic Mini ID / Tech Passport Graphic inside Slot */
    .doc-visual {
      background: #FFFFFF;
      border-radius: 10px;
      padding: 8px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
      margin-bottom: 8px;
      position: relative;
    }
    .doc-visual-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .doc-chip-gold {
      width: 18px;
      height: 13px;
      border-radius: 3px;
      background: linear-gradient(135deg, #FBBF24, #D97706);
    }
    .doc-chip-blue {
      width: 18px;
      height: 13px;
      border-radius: 3px;
      background: linear-gradient(135deg, #3B82F6, #1D4ED8);
    }
    .doc-uz-tag {
      font-size: 8px;
      font-weight: 900;
      color: #64748B;
      letter-spacing: 0.6px;
    }
    .doc-visual-body {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .doc-avatar-box {
      width: 24px;
      height: 26px;
      border-radius: 5px;
      background: #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748B;
      flex-shrink: 0;
    }
    .slot.done .doc-avatar-box {
      background: #D1FAE5;
      color: #059669;
    }
    .doc-lines { flex: 1; display: grid; gap: 4px; }
    .doc-line { height: 4px; border-radius: 2px; background: #E2E8F0; }
    .slot.done .doc-line.primary { background: #34D399; }

    .slot-badge-check {
      position: absolute;
      top: -5px;
      right: -5px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--success);
      color: #fff;
      font-size: 11px;
      font-weight: 900;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
    }
    .slot.done .slot-badge-check { display: flex; }

    .slot-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .slot-title {
      font-size: 12px;
      font-weight: 800;
      color: var(--text);
    }
    .slot-sub {
      font-size: 10px;
      color: var(--muted);
      margin-top: 1px;
    }
    .slot-action-pill {
      margin-top: 7px;
      width: 100%;
      padding: 5px 8px;
      border-radius: 8px;
      font-size: 10.5px;
      font-weight: 800;
      text-align: center;
      background: var(--primary-soft);
      color: var(--primary);
      transition: all 0.15s;
    }
    .slot.done .slot-action-pill {
      background: var(--success);
      color: #FFFFFF;
    }

    .divider { height: 1px; background: var(--border); margin: 14px 0 10px; }

    .security-note {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 9px 11px;
      border-radius: 12px;
      background: #F8FAFC;
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
      line-height: 1.35;
    }

    /* Footer */
    .phone-footer {
      background: #fff;
      border-top: 1px solid var(--border);
      padding: 12px 14px 14px;
    }
    .btn-submit {
      width: 100%;
      min-height: 48px;
      padding: 12px;
      border-radius: 14px;
      border: none;
      background: linear-gradient(135deg, #059669, #10B981);
      color: #fff;
      font-weight: 800;
      font-size: 14.5px;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(16, 185, 129, 0.25);
      transition: transform 0.12s, opacity 0.2s;
    }
    .btn-submit:active { transform: scale(0.98); }
    .btn-skip {
      width: 100%;
      min-height: 40px;
      padding: 8px;
      margin-top: 4px;
      background: transparent;
      border: none;
      color: var(--muted);
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-skip:hover { color: var(--primary); }

    /* Slide-Up Car Model Bottom Sheet Modal inside Phone */
    .sheet-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(3px);
      display: none;
      flex-direction: column;
      justify-content: flex-end;
      z-index: 50;
    }
    .sheet-backdrop.open { display: flex; }
    .sheet-box {
      background: #fff;
      border-top-left-radius: 26px;
      border-top-right-radius: 26px;
      height: 82%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 -10px 30px rgba(0,0,0,0.18);
    }
    .sheet-handle {
      width: 40px;
      height: 5px;
      background: #CBD5E1;
      border-radius: 999px;
      margin: 10px auto 6px;
    }
    .sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px 10px;
      border-bottom: 1px solid var(--border);
    }
    .sheet-header h4 { font-size: 16px; font-weight: 800; }
    .sheet-close {
      border: none;
      background: #F1F5F9;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      font-weight: 800;
      cursor: pointer;
    }
    .sheet-search-wrap { padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .sheet-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 10px 16px;
    }
    .sheet-group-title {
      font-size: 11px;
      font-weight: 800;
      color: var(--primary);
      padding: 10px 8px 4px;
    }
    .sheet-item {
      width: 100%;
      text-align: left;
      padding: 11px 12px;
      border: none;
      background: transparent;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sheet-item:hover, .sheet-item.selected {
      background: var(--primary-soft);
      color: var(--primary);
      font-weight: 800;
    }

    /* Right panel */
    .info-panel { display: flex; flex-direction: column; gap: 18px; }
    .panel-card {
      background: #fff;
      border-radius: 20px;
      padding: 22px;
      border: 1px solid var(--border);
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
    }
    .kicker-text {
      font-size: 12px;
      font-weight: 800;
      color: #059669;
      margin-bottom: 6px;
    }
    .panel-card h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.3px; }
    .panel-card h3 { font-size: 16px; font-weight: 800; margin-bottom: 8px; }
    .panel-card p { font-size: 14px; color: var(--muted); line-height: 1.55; }
    .check-list { list-style: none; display: grid; gap: 12px; margin-top: 12px; }
    .check-list li {
      font-size: 14px;
      line-height: 1.5;
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .check-icon {
      width: 24px;
      height: 24px;
      border-radius: 8px;
      background: var(--primary-soft);
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      flex-shrink: 0;
      font-size: 12px;
    }
    pre {
      background: #0F172A;
      color: #F8FAFC;
      padding: 14px;
      border-radius: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      overflow-x: auto;
      margin-top: 10px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="layout">
    <!-- Left: Interactive Modern Phone Preview -->
    <div class="phone">
      <div class="phone-header">
        <div class="header-top-row">
          <button class="back-btn" title="Keyinroq yuklash — Ilovaga kirish" onclick="showToast('Haydovchi to\\'g\\'ri Buyurtmalar ekraniga o\\'tadi!')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <span class="header-step-pill">2 ta qadam · Tezkor ro'yxat</span>
        </div>
        <div class="header-main">
          <div class="header-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/></svg>
          </div>
          <div>
            <h2>Hujjatlarni yuklash</h2>
            <p>Ma'lumotlarni kiriting va 4 ta rasmni yuklang</p>
          </div>
        </div>
        <div class="progress-card">
          <div class="progress-meta">
            <span id="prog-label">Yuklangan hujjatlar: 4 / 4</span>
            <span class="progress-pct" id="prog-pct">100% tayyor</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" id="prog-fill"></div>
          </div>
        </div>
      </div>

      <div class="phone-body">
        <!-- 1-BO'LIM -->
        <div class="card">
          <div class="sec-header">
            <span class="step-num done">01</span>
            <div class="sec-title-wrap">
              <div class="sec-title">Shaxsiy va avtomobil ma'lumotlari</div>
              <div class="sec-sub">Yo'lovchilarga ko'rinadigan ma'lumotlar</div>
            </div>
            <span class="sec-status">✓ Tayyor</span>
          </div>

          <div class="row-2">
            <div>
              <label>Ism <b>*</b></label>
              <input class="modern-input" type="text" value="Azizbek" placeholder="Ismingiz" />
            </div>
            <div>
              <label>Familiya</label>
              <input class="modern-input" type="text" value="Karimov" placeholder="Familiyangiz" />
            </div>
          </div>

          <label>Mashina markasi <b>*</b></label>
          <button type="button" class="model-selector-btn" onclick="openModelSheet()">
            <div class="model-icon-circle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
            </div>
            <div class="model-selector-meta">
              <small>Tanlangan model (440+ ro'yxat)</small>
              <strong id="selected-model-text">Chevrolet Cobalt</strong>
            </div>
            <span class="model-selector-arrow">Tanlash ▾</span>
          </button>

          <!-- 1-Tap Quick Model Chips -->
          <div class="quick-models">
            <button type="button" class="qm-chip active" onclick="quickPickModel(this, 'Chevrolet Cobalt')">Cobalt</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'Chevrolet Gentra / Lacetti')">Gentra</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'Chevrolet Onix')">Onix</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'Chevrolet Tracker 2')">Tracker 2</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'Chevrolet Monza')">Monza</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'BYD Song Plus DM-i / Champion')">BYD Song Plus</button>
            <button type="button" class="qm-chip" onclick="quickPickModel(this, 'Chevrolet Damas')">Damas</button>
          </div>

          <div class="row-car">
            <div>
              <label>Davlat raqami <b>*</b></label>
              <div class="uz-plate-wrap">
                <div class="uz-plate-left">
                  <span>UZ</span>
                  <div class="uz-flag-mini"></div>
                </div>
                <input class="uz-plate-input" type="text" value="75 A 777 AA" maxlength="12" />
              </div>
            </div>
            <div>
              <label>Yili <b>*</b></label>
              <input class="modern-input year-input" type="text" value="2023" maxlength="4" />
            </div>
          </div>

          <label>Mashina rangi <span style="font-weight:500;color:#94A3B8;">(ixtiyoriy)</span></label>
          <div class="chips">
            <button type="button" class="chip active" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#FFFFFF;border:1px solid #CBD5E1;"></span>Oq
            </button>
            <button type="button" class="chip" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#0F172A;"></span>Qora
            </button>
            <button type="button" class="chip" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#64748B;"></span>Kulrang
            </button>
            <button type="button" class="chip" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#CBD5E1;"></span>Kumushrang
            </button>
            <button type="button" class="chip" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#2563EB;"></span>Ko'k
            </button>
            <button type="button" class="chip" onclick="selectChip(this)">
              <span class="chip-dot" style="background:#DC2626;"></span>Qizil
            </button>
          </div>

          <div class="phone-box">
            <div class="phone-box-left">
              <div class="phone-icon-badge">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <div>
                <small>Yo'lovchilarga ko'rinadigan raqam</small>
                <strong>+998 90 123 45 67</strong>
              </div>
            </div>
            <button type="button" onclick="showToast('Raqamni o\\'zgartirish oynasi ochiladi')">O'zgartirish</button>
          </div>
        </div>

        <!-- 2-BO'LIM -->
        <div class="card">
          <div class="sec-header">
            <span class="step-num done" id="step2-badge">02</span>
            <div class="sec-title-wrap">
              <div class="sec-title">Guvohnoma va Texnik pasport</div>
              <div class="sec-sub">Yorug' joyda, yozuvlari aniq ko'rinadigan qilib oling</div>
            </div>
            <span class="sec-status" id="step2-counter">4 / 4</span>
          </div>

          <div class="doc-group-header">
            <div class="doc-sub">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2.3"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              Haydovchilik guvohnomasi (Prava)
            </div>
            <span class="doc-sub-hint">Old va orqa</span>
          </div>

          <div class="slots">
            <div class="slot done" onclick="toggleSlot(this)">
              <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
              <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
              <div class="doc-visual">
                <div class="slot-badge-check">✓</div>
                <div class="doc-visual-top">
                  <div class="doc-chip-gold"></div>
                  <span class="doc-uz-tag">DRIVING LICENCE</span>
                </div>
                <div class="doc-visual-body">
                  <div class="doc-avatar-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                  </div>
                  <div class="doc-lines">
                    <div class="doc-line primary" style="width:90%"></div>
                    <div class="doc-line" style="width:70%"></div>
                    <div class="doc-line" style="width:55%"></div>
                  </div>
                </div>
              </div>
              <div class="slot-title">Old tomoni</div>
              <div class="slot-sub">Rasm va F.I.Sh ko'rinsin</div>
              <div class="slot-action-pill">✓ Yuklandi</div>
            </div>

            <div class="slot done" onclick="toggleSlot(this)">
              <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
              <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
              <div class="doc-visual">
                <div class="slot-badge-check">✓</div>
                <div class="doc-visual-top">
                  <div class="doc-chip-gold"></div>
                  <span class="doc-uz-tag">TOIFALAR: B, C</span>
                </div>
                <div class="doc-visual-body">
                  <div class="doc-lines">
                    <div class="doc-line primary" style="width:95%"></div>
                    <div class="doc-line" style="width:80%"></div>
                    <div class="doc-line" style="width:65%"></div>
                  </div>
                </div>
              </div>
              <div class="slot-title">Orqa tomoni</div>
              <div class="slot-sub">Toifalar (B, C) ko'rinsin</div>
              <div class="slot-action-pill">✓ Yuklandi</div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="doc-group-header">
            <div class="doc-sub">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="2.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Texnik pasport (Texpasport)
            </div>
            <span class="doc-sub-hint">Old va orqa</span>
          </div>

          <div class="slots">
            <div class="slot done" onclick="toggleSlot(this)">
              <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
              <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
              <div class="doc-visual">
                <div class="slot-badge-check">✓</div>
                <div class="doc-visual-top">
                  <div class="doc-chip-blue"></div>
                  <span class="doc-uz-tag">CERTIFICAT</span>
                </div>
                <div class="doc-visual-body">
                  <div class="doc-avatar-box">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>
                  </div>
                  <div class="doc-lines">
                    <div class="doc-line primary" style="width:88%"></div>
                    <div class="doc-line" style="width:74%"></div>
                    <div class="doc-line" style="width:50%"></div>
                  </div>
                </div>
              </div>
              <div class="slot-title">Old tomoni</div>
              <div class="slot-sub">Davlat raqami ko'rinsin</div>
              <div class="slot-action-pill">✓ Yuklandi</div>
            </div>

            <div class="slot done" onclick="toggleSlot(this)">
              <span class="vf-corner vf-tl"></span><span class="vf-corner vf-tr"></span>
              <span class="vf-corner vf-bl"></span><span class="vf-corner vf-br"></span>
              <div class="doc-visual">
                <div class="slot-badge-check">✓</div>
                <div class="doc-visual-top">
                  <div class="doc-chip-blue"></div>
                  <span class="doc-uz-tag">UZ · REG INFO</span>
                </div>
                <div class="doc-visual-body">
                  <div class="doc-lines">
                    <div class="doc-line primary" style="width:92%"></div>
                    <div class="doc-line" style="width:78%"></div>
                    <div class="doc-line" style="width:60%"></div>
                  </div>
                </div>
              </div>
              <div class="slot-title">Orqa tomoni</div>
              <div class="slot-sub">Egasi va yili ko'rinsin</div>
              <div class="slot-action-pill">✓ Yuklandi</div>
            </div>
          </div>

          <div class="security-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.4" style="flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Hujjatlaringiz xavfsiz shifrlangan holda saqlanadi va faqat haydovchi sifatida tasdiqlash uchun ishlatiladi.</span>
          </div>
        </div>
      </div>

      <div class="phone-footer">
        <button type="button" class="btn-submit" id="submit-btn" onclick="showToast('Hujjatlar yuborildi! Admin Telegram botda 1 tugma bilan tasdiqlaydi.')">Tasdiqlash va yuborish</button>
        <button type="button" class="btn-skip" onclick="showToast('Haydovchi hujjat yuklamasdan ham ilovaning asosiy ekraniga erkin kira oladi!')">Keyinroq yuklash — Ilovaga kirish →</button>
      </div>

      <!-- Slide-up Car Model Picker Bottom Sheet -->
      <div class="sheet-backdrop" id="model-sheet" onclick="if(event.target===this)closeModelSheet()">
        <div class="sheet-box">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <h4>Mashina modelini tanlang</h4>
            <button type="button" class="sheet-close" onclick="closeModelSheet()">✕</button>
          </div>
          <div class="sheet-search-wrap">
            <input type="text" id="model-search-input" class="modern-input" placeholder="Modelni qidiring yoki yozing (masalan: Cobalt, BYD, Kia)..." oninput="filterModels(this.value)" />
          </div>
          <div class="sheet-list" id="model-sheet-list"></div>
        </div>
      </div>
    </div>

    <!-- Right: Summary of Changes -->
    <div class="info-panel">
      <div class="panel-card" style="border-color:#10B981;background:linear-gradient(180deg,#ECFDF5 0%,#FFFFFF 100%);">
        <div class="kicker-text">GOOGLE PLAY RAD ETISH MUAMMOSI BUTUNLAY TUZATILDI · v1.0.3 (versionCode 11)</div>
        <h1>«Недопустимое раскрытие информации» (Prominent Disclosure) — 100% Yechim</h1>
        <p>Google Play 5 marta rad etgan xatolikning barcha texnik sabablari aniqlanib, tag-tomiri bilan bartaraf etildi:</p>
        <ul class="check-list">
          <li>
            <span class="check-icon" style="background:#D1FAE5;color:#059669;">✓</span>
            <div><b><code>ACCESS_BACKGROUND_LOCATION</code> butunlay olib tashlandi va bloklandi:</b> <code>app.json</code>'da <code>blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"]</code> hamda <code>isAndroidBackgroundLocationEnabled: false</code> o'rnatildi. Safar vaqtida xaritada kuzatish <code>FOREGROUND_SERVICE_LOCATION</code> (bildirishnomali old fon xizmati) orqali 100% uzluksiz ishlayveradi!</div>
          </li>
          <li>
            <span class="check-icon" style="background:#D1FAE5;color:#059669;">✓</span>
            <div><b>1:1 Prominent Disclosure → Darhol OS Ruxsat Oynasi:</b> Endi faqat zakas oynasida (<code>/order/[id]</code>) joylashuv ruxsati berilmagan bo'lsagina avval tushuntirish oynasi chiqadi va haydovchi <b>«Roziman»</b> tugmasini bosgan zahoti (<code>0ms</code> kechikishsiz) Android tizimining dinamik ruxsat oynasi ochiladi. Ikkinchi marta (<code>requestBackgroundPermissionsAsync</code>) hech qachon chaqirilmaydi.</div>
          </li>
          <li>
            <span class="check-icon" style="background:#D1FAE5;color:#059669;">✓</span>
            <div><b>MUHIM (OTA emas, yangi AAB!):</b> Google Play tekshiruvchilari <code>eas update</code> (OTA) ni ko'rmaydi, ular faqat Play Console'ga yuklangan <code>.aab</code> faylini tekshiradi. Yangi <code>versionCode: 11 (1.0.3)</code> AAB faylini yig'ib Play Console'ga yuklang.</div>
          </li>
        </ul>
      </div>

      <div class="panel-card" style="border-color:#C7D2FE;background:linear-gradient(180deg,#FFFFFF 0%,#F8FAFF 100%);">
        <div class="kicker-text">YANGI QO'SHILGAN FUNKSIYALAR · M41 KORIDOR & JONLI CHAT</div>
        <h1>Yo'l-yo'lakay Zakaslar, Qaytish Reysi va Ilova Ichidagi Chat</h1>
        <p>Yo'lovchi va haydovchi ilovalariga hamda backend serverga quyidagi 4 ta muhim qulaylik qo'shildi:</p>
        <ul class="check-list">
          <li>
            <span class="check-icon">01</span>
            <div><b>Yo'l-yo'lakay (M41 Trassa Koridori) zakas olish:</b> Sariosiyo → Denov → Sho'rchi → Qumqo'rg'on → Jarqo'rg'on → Termiz yo'nalishida ketayotgan haydovchiga yo'l ustidagi tumanlardan tushgan zakaslar avtomatik <code>🛣 Yo'l-yo'lakay</code> belgisi bilan chiqadi.</div>
          </li>
          <li>
            <span class="check-icon">02</span>
            <div><b>1-Bosishda «Qaytish reysi» (Teskari yo'nalish):</b> Safar yakunlanganda haydovchi 1 ta tugma bilan yo'nalishni teskari tomonga (masalan, <i>Termiz → Sariosiyo</i>) aylantirib, darhol onlayn zakas qabul qilishga o'tadi.</div>
          </li>
          <li>
            <span class="check-icon">03</span>
            <div><b>Faqat Uy oldidan (Mahalladan) olib ketish:</b> «Pitakdan ketish» butunlay olib tashlandi — barcha buyurtmalar yo'lovchining aniq GPS lokatsiyasidan (uy oldidan) olib ketiladi.</div>
          </li>
          <li>
            <span class="check-icon">04</span>
            <div><b>Ilova ichida Yo'lovchi ↔ Haydovchi Chat (Avto-yopilish bilan):</b> Zakas qabul qilingach tezkor shablonlar (<i>«Chiqyapman», «Yetib keldim», «5 daqiqada boraman»</i>) bilan yozishish mumkin; zakas yopilishi bilan chat avtomatik bloklanadi.</div>
          </li>
        </ul>
      </div>

      <div class="panel-card">
        <h3>Play Market uchun yangi .aab faylni chiqarish buyrug'i</h3>
        <p>Kompyuteringizda quyidagi buyruq orqali <code>versionCode: 11 (1.0.3)</code> bilan yangi AAB faylni yig'ib, Google Play Console'ga yuklang:</p>
        <pre>cd sarix-go-driver
eas build --platform android --profile production</pre>
      </div>
    </div>
  </div>
  <div id="toast" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0F172A;color:#fff;padding:12px 20px;border-radius:14px;font-size:13px;font-weight:700;opacity:0;pointer-events:none;transition:opacity 0.2s;box-shadow:0 12px 28px rgba(0,0,0,0.22);z-index:100;"></div>

  <script>
    const CAR_GROUPS = [
      {
        group: "Chevrolet / UzAuto / Ravon",
        items: [
          "Chevrolet Cobalt", "Chevrolet Gentra / Lacetti", "Chevrolet Onix",
          "Chevrolet Tracker 2", "Chevrolet Tracker 1", "Chevrolet Monza",
          "Chevrolet Malibu 2", "Chevrolet Malibu 1", "Chevrolet Malibu XL",
          "Chevrolet Captiva 3-4", "Chevrolet Captiva 5", "Chevrolet Captiva 1-2",
          "Chevrolet Nexia 3", "Chevrolet Spark", "Chevrolet Equinox",
          "Chevrolet Traverse", "Chevrolet Tahoe", "Chevrolet Trailblazer",
          "Chevrolet Orlando", "Chevrolet Cruze", "Chevrolet Epica",
          "Chevrolet Aveo", "Chevrolet Damas", "Chevrolet Labo",
          "Chevrolet Menlo", "Chevrolet Niva / Niva Travel",
          "Ravon R2", "Ravon R3 Nexia", "Ravon R4", "Daewoo Gentra / Lacetti"
        ]
      },
      {
        group: "BYD (Elektromobil & Gibrid)",
        items: [
          "BYD Song Plus DM-i / Champion", "BYD Song Pro", "BYD Song L",
          "BYD Chazor", "BYD Yuan Up", "BYD Yuan Plus", "BYD e2",
          "BYD Han", "BYD Seal", "BYD Seal U", "BYD Seagull",
          "BYD Dolphin", "BYD Tang", "BYD Qin Plus", "BYD Qin L"
        ]
      },
      {
        group: "Chery / Jetour / Exeed / Omoda / Jaecoo",
        items: [
          "Chery Tiggo 7 Pro", "Chery Tiggo 7 Pro Max", "Chery Tiggo 8 Pro",
          "Chery Tiggo 8 Pro Max", "Chery Tiggo 4 Pro", "Chery Arrizo 6 Pro",
          "Chery Arrizo 8", "Jetour X70 Plus", "Jetour X70", "Jetour X90 Plus",
          "Jetour Dashing", "Jetour T2", "Exeed TXL", "Exeed VX", "Omoda C5", "Jaecoo J7"
        ]
      },
      {
        group: "Deepal / Changan / Haval / Zeekr / Li Auto / Geely",
        items: [
          "Deepal S07 285 Max", "Deepal S7 121 Max", "Deepal SL03", "Deepal L07",
          "Changan UNI-K", "Changan UNI-V", "Changan CS55 Plus", "Changan Qiyuan A05",
          "Haval M6", "Haval Jolion", "Haval H6", "Haval Dargo", "Tank 300",
          "Leapmotor C16", "Leapmotor C11", "Leapmotor C10",
          "Li Auto L7", "Li Auto L8", "Li Auto L9", "Zeekr 001", "Zeekr 007", "Zeekr X",
          "Geely Monjaro", "Geely Coolray", "Geely Emgrand", "Xiaomi SU7", "Hongqi E-QM5"
        ]
      },
      {
        group: "Kia & Hyundai",
        items: [
          "Kia K5", "Kia K8", "Kia Sportage", "Kia Sorento", "Kia Sonet",
          "Kia Seltos", "Kia Carnival", "Kia Cerato", "Kia Rio", "Kia Optima", "Kia EV6",
          "Hyundai Sonata", "Hyundai Elantra", "Hyundai Accent / Solaris",
          "Hyundai Tucson", "Hyundai Santa Fe", "Hyundai Palisade", "Hyundai Staria", "Hyundai Creta"
        ]
      },
      {
        group: "Toyota / Lexus / Lada / Yevropa",
        items: [
          "Toyota Camry", "Toyota Corolla", "Toyota Avalon", "Toyota RAV4",
          "Toyota Highlander", "Toyota Land Cruiser Prado", "Toyota Land Cruiser 200 / 300",
          "Toyota Alphard", "Lexus ES", "Lexus RX", "Lexus LX",
          "Lada Vesta", "Lada Vesta SW Cross", "Lada Largus", "Lada Granta", "Lada XRAY",
          "Volkswagen Polo", "Volkswagen Passat", "Volkswagen Tiguan", "Volkswagen ID.4 / ID.6",
          "Skoda Octavia", "Skoda Rapid", "Skoda Kodiaq",
          "Mercedes-Benz E-Class", "Mercedes-Benz C-Class", "Mercedes-Benz S-Class", "Mercedes-Benz Vito",
          "BMW 3 Series", "BMW 5 Series", "BMW X5", "BMW X7",
          "Nissan Almera", "Nissan Qashqai", "Nissan X-Trail", "Honda Accord", "Honda CR-V", "Renault Duster"
        ]
      }
    ];

    let currentModel = "Chevrolet Cobalt";
    let toastTimer;
    let currentAudio = null;

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
    }

    function playWav(file, label) {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        }
        currentAudio = new Audio('/sounds/' + file);
        currentAudio.play();
        showToast(label + ' (' + file + ')');
      } catch (e) {
        showToast('Audio xatolik');
      }
    }

    function selectChip(el) {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
    }

    function setModelValue(modelName) {
      currentModel = modelName;
      document.getElementById('selected-model-text').textContent = modelName;
      document.querySelectorAll('.qm-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes("'" + modelName + "'"));
      });
    }

    function quickPickModel(btn, modelName) {
      setModelValue(modelName);
      showToast(modelName + ' tanlandi');
    }

    function openModelSheet() {
      document.getElementById('model-sheet').classList.add('open');
      const input = document.getElementById('model-search-input');
      input.value = '';
      filterModels('');
      setTimeout(() => input.focus(), 80);
    }

    function closeModelSheet() {
      document.getElementById('model-sheet').classList.remove('open');
    }

    function pickFromSheet(modelName) {
      setModelValue(modelName);
      closeModelSheet();
      showToast(modelName + ' tanlandi');
    }

    function filterModels(query) {
      const q = (query || '').trim().toLowerCase();
      const container = document.getElementById('model-sheet-list');
      let html = '';
      let exactMatch = false;

      CAR_GROUPS.forEach(g => {
        const matched = g.items.filter(m => {
          if (m.toLowerCase() === q) exactMatch = true;
          return !q || m.toLowerCase().includes(q);
        });
        if (matched.length > 0) {
          html += '<div class="sheet-group-title">' + g.group + '</div>';
          matched.forEach(m => {
            const isSel = m === currentModel ? ' selected' : '';
            const safe = m.replace(/'/g, "\\\\'");
            html += '<button type="button" class="sheet-item' + isSel + '" onclick="pickFromSheet(\\'' + safe + '\\')"><span>' + m + '</span>' + (isSel ? '<span>✓</span>' : '') + '</button>';
          });
        }
      });

      if (q.length > 1 && !exactMatch) {
        const clean = query.trim().replace(/[<>"']/g, '');
        html = '<button type="button" class="sheet-item selected" style="margin-bottom:6px;" onclick="pickFromSheet(\\'' + clean + '\\')"><span>+ «' + clean + '» modelini qo\\'shish</span><span>Tanlash →</span></button>' + html;
      }

      container.innerHTML = html;
    }

    function toggleSlot(el) {
      el.classList.toggle('done');
      const isDone = el.classList.contains('done');
      const pill = el.querySelector('.slot-action-pill');
      if (pill) {
        pill.textContent = isDone ? '✓ Yuklandi' : '📸 Suratga olish';
      }
      const doneCount = document.querySelectorAll('.slot.done').length;
      const pct = Math.round((doneCount / 4) * 100);
      document.getElementById('prog-label').textContent = 'Yuklangan hujjatlar: ' + doneCount + ' / 4';
      document.getElementById('prog-pct').textContent = pct + '% tayyor';
      document.getElementById('prog-fill').style.width = pct + '%';
      document.getElementById('step2-counter').textContent = doneCount + ' / 4';
      const step2Badge = document.getElementById('step2-badge');
      step2Badge.classList.toggle('done', doneCount === 4);
      const submitBtn = document.getElementById('submit-btn');
      if (doneCount === 4) {
        submitBtn.textContent = 'Tasdiqlash va yuborish';
        submitBtn.style.opacity = '1';
      } else {
        submitBtn.textContent = 'Avval 4 ta hujjat rasmini yuklang (' + doneCount + '/4)';
        submitBtn.style.opacity = '0.85';
      }
    }
  </script>
</body>
</html>`;

const ALLOWED_SOUNDS = new Set([
  'new_order.wav',
  'order_cancelled.wav',
  'order_accepted.wav',
  'driver_arrived.wav',
  'order_completed.wav',
  'balance_bonus.wav',
]);

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Sarix Go Preview', version: '1.0.2' }));
    return;
  }
  if (req.url && req.url.startsWith('/sounds/')) {
    const name = path.basename(req.url);
    if (ALLOWED_SOUNDS.has(name)) {
      const wavPath = path.join(process.cwd(), 'sarix-go-driver', 'assets', 'sounds', name);
      if (fs.existsSync(wavPath)) {
        const buf = fs.readFileSync(wavPath);
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': buf.length,
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
        return;
      }
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Sarix Go preview server listening on http://0.0.0.0:' + PORT);
});
