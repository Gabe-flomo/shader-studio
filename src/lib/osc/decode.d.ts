export interface DecodedOsc { address: string; args: Array<number | string | boolean | null> }
export function decodeOsc(data: Uint8Array | ArrayBuffer): DecodedOsc[];
export function encodeOsc(address: string, args?: Array<number | string | boolean | { i: number }>): Uint8Array;
