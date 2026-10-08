# Jupiter instruction schema

`jupiter-idl.ts` pins route/shared-account exact-input v1/v2 and types from the
Anchor IDL stored by the deployed Jupiter program
`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, read through
`Program.fetchIdl` on 2026-10-07. Snake-case instruction/account/field names are
converted to camelCase without changing discriminators, types or enum order.
Unknown layouts fail closed. Source raw JSON SHA-256: `12a0856158b2b6927d683a2ba21566f82e39989aca476e23c02d845fc38cdca8`.

Reference: https://developers.jup.ag/docs/swap/build
Earlier decoder: https://github.com/jup-ag/instruction-parser

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.


# Meteora DLMM pool identity schema

`dlmm-idl.ts` preserves only `LbPair` and its transitive type definitions from
Meteora's official IDL at commit `2f540c2107988e0f97efa5917100bb912c96c17a`.
Documentation fields are omitted; names, discriminator, field order and types
are unchanged. The pinned layout is 904 bytes including the discriminator.
This schema only identifies pool assets; it does not build DLMM swaps.

Source: https://github.com/MeteoraAg/dlmm-sdk/blob/2f540c2107988e0f97efa5917100bb912c96c17a/idls/dlmm.json
Raw source SHA-256: `045c0f4af044be046b6a14b350077e4242e8ac026b64a855803dab30fcdd8b35`.
