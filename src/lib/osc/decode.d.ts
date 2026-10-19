export interface DecodedOsc { address: string; args: Array<number | string | boolean | null> }
export function decodeOsc(data: Uint8Array | ArrayBuffer): DecodedOsc[];
export function encodeOsc(address: string, args?: Array<number | string | boolean | { i: number } | { d: number }>): Uint8Array;
export function encodeBundle(messages: Uint8Array[]): Uint8Array;
