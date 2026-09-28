/**
 * The secrets that ship inside the app, in one place.
 *
 * These are obscurity, not security. They are plain strings in the app's
 * bundle: anyone who reads the app's code (a minute with the developer tools,
 * or `strings` on the desktop binary) has them, and with them can decrypt any
 * .playfile or sealed node pack the app ever wrote. What they buy is that a
 * .playfile isn't a ZIP any archive tool opens, and a sealed node's GLSL
 * isn't text in a file: casual opening, extraction and importing elsewhere
 * stop working, and a changed file is refused. They don't stop a determined
 * person, and nothing about them should be described as protection against
 * one. docs/playfile-format.md ("Container v2" and "What sealing does not do")
 * and docs/accounts-and-plans.md §9 say so.
 *
 * Changing a secret makes every file written under the old one unreadable, so
 * a new one means a new version (the container's version byte, a sealed
 * blob's `v`) with the old secret kept for reading. A later step can derive
 * Pro or licence-bound keys instead (see the docs); the module boundary is
 * here so that swap touches one file.
 */

/** The .playfile container (v2): mixed with each file's own salt through HKDF. */
export const PLAYFILE_CONTAINER_SECRET = 'playfield/playfile-container/v2/b7e3d2c1-5a48-4f6e-9c0d-1e2f3a4b5c6d';

/** Sealed node packs (v1): mixed with each node's own salt through HKDF. */
export const SEALED_NODE_SECRET = 'playfield/sealed-node-pack/v1/4f1c9a2e-7b7d-4a53-9d0e-2c8f6b1e5a90';
