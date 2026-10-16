# Related-card face assets v1

Vendored from the official [face-api.js 0.22.2 release](https://github.com/justadudewhohacks/face-api.js/tree/0.22.2), immutable commit `8609b25a15f417398a4d2b95dc91985cd1e0c0c3`. License: MIT; the unmodified upstream license is in `LICENSE`.

The library is the upstream `dist/face-api.min.js`. The only downloaded weights are `tiny_face_detector_model` and `face_landmark_68_tiny_model`, from that same commit's `weights/` directory. Runtime loads only these two networks. No recognition, age, gender or emotion weights are shipped or loaded. No external runtime request, API key, camera, identity matching, or face-data upload is used.

## Runtime budget and policy

- At most 12 cards per page, at most two unique same-origin `/img/` source URLs per card; alternative is only tried if the hero has no approved face.
- Lazy start within 240px of viewport; one shared model promise and sequential image processing. Successes, empty detections and failures are cached per URL for the page lifetime. No retry loop.
- Library and each model fetch have 8-second network deadlines; image loading has an 8-second deadline. Detector input is fixed at 512px, confidence floor 0.80.
- Conservative landmark gate requires both visible eyes, adequate eye spacing and symmetry, centered nose and visible mouth; minimum face 48×56px, 0.6% source area, and a 2px source-edge margin. At most four approved faces, largest first.
- Crop frame height is the larger of 1.65× face height and the height needed to include 1.18× face width, clamped to source bounds with correct aspect ratio. Framing remains consistent between faces unless the source edge makes that physically impossible.
- One face stays fixed. Multiple approved faces crossfade for 240ms every 3500ms; pause offscreen, in hidden tabs, with reduced motion, or via the keyboard-focus pause button.
- The original photo stays visible while detection is pending or unavailable, and when no face passes the conservative gate. Zoom/rotation are enhancements only; model failure does not remove a valid image. Only genuinely missing/broken sources can leave a text-only card. A detection score is not a calibrated probability or a guarantee of pose correctness.

## Reproduction / integrity

Download paths from `https://raw.githubusercontent.com/justadudewhohacks/face-api.js/8609b25a15f417398a4d2b95dc91985cd1e0c0c3/`: `dist/face-api.min.js`, `LICENSE`, and each model manifest/shard under `weights/`.

| File | Bytes | gzip bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `LICENSE` | 1,072 | 653 | `d5480b4d4e46880107a56db666697ec3e90def81a8fc829e530b1c291e3172a5` |
| `face-api.min.js` | 663,829 | 160,405 | `5d66ec95338d7fcc365ce15481b8599baf4b6e22c9a624b76d4ca821a669a659` |
| `face_landmark_68_tiny_model-shard1` | 77,224 | 62,326 | `b98e9f2f7da76f8a6dda9741a36ed485b224b889d552de2b2c1bb16217f67bfc` |
| `face_landmark_68_tiny_model-weights_manifest.json` | 4,441 | 949 | `3c63b8984302c187b218d9ef5aa149ed8c2c7fa3fe54db078614692bc48d153c` |
| `tiny_face_detector_model-shard1` | 193,321 | 157,874 | `b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871` |
| `tiny_face_detector_model-weights_manifest.json` | 2,953 | 743 | `14c60659a31b6b7b1320077171b8f8adcb24ef0e62dde62ce603bcb49a1b49b5` |
