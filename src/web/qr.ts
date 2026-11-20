import { renderSVG } from "uqr";

export function voucherQr(code?: any) : any {
  return renderSVG(code, { ecc: "M", border: 2 });
}
