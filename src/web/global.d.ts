import type { FitGameConfig } from "../shared/api.ts";

declare global {
  interface Window {
    FIT_GAME_CONFIG?: FitGameConfig;
    FIT_CONFIG?: any;
    google?: any;
    gapi?: any;
    BarcodeDetector?: any;
  }
  interface Document {
    getElementById(elementId: string): any;
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): any;
  }
  interface HTMLElement {
    value: any;
    files?: any;
    checked?: any;
    disabled?: any;
    selectionStart?: any;
    setSelectionRange?(start: number, end: number): void;
  }
  interface Element {
    value?: any;
    dataset: DOMStringMap;
    open?: boolean;
  }
  interface Error {
    status?: number;
  }
}

export {};
