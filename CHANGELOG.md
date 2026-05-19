# Changelog

## [1.6.0](https://github.com/dotennin/bili-webos/compare/bili-webos-tv-v1.5.0...bili-webos-tv-v1.6.0) (2026-05-19)


### Features

* media player FF/FW go through ([#83](https://github.com/dotennin/bili-webos/issues/83)) ([038933d](https://github.com/dotennin/bili-webos/commit/038933d8b256da9cbf7d654b8942dabb0dd05848))


### Bug Fixes

* service on webos ([#84](https://github.com/dotennin/bili-webos/issues/84)) ([0e33210](https://github.com/dotennin/bili-webos/commit/0e332104143f2d780f9e42ce1565a3e161b957ad))

## [1.5.0](https://github.com/dotennin/bili-webos/compare/bili-webos-tv-v1.4.0...bili-webos-tv-v1.5.0) (2026-05-18)


### Features

* add Typescript, Biome, and CI build flow ([#74](https://github.com/dotennin/bili-webos/issues/74)) ([d1c32c6](https://github.com/dotennin/bili-webos/commit/d1c32c6de766117c2c9efecaf1a8790626595e45))

## [1.4.0](https://github.com/dotennin/bili-webos/compare/bili-webos-tv-v1.3.0...bili-webos-tv-v1.4.0) (2026-05-18)


### Features

* add one-command dev startup ([#28](https://github.com/dotennin/bili-webos/issues/28)) ([31e7afa](https://github.com/dotennin/bili-webos/commit/31e7afaeeed69b540f2637ee8fc567d31eab9bf6))
* DLNA server ([5b2da28](https://github.com/dotennin/bili-webos/commit/5b2da28369f8b69318ec6671a19779c067410294))
* live steam ([#4](https://github.com/dotennin/bili-webos/issues/4)) ([913592f](https://github.com/dotennin/bili-webos/commit/913592f1eb07623f180376788810266ce2e76ccf))
* one command dev mode ([#31](https://github.com/dotennin/bili-webos/issues/31)) ([5374634](https://github.com/dotennin/bili-webos/commit/53746340f4ee6060810a30cf02f9206f64ab61c9))
* **player:** support media remote hotkeys for playback control ([#13](https://github.com/dotennin/bili-webos/issues/13)) ([db66b3f](https://github.com/dotennin/bili-webos/commit/db66b3fb4c86c41bdc0973e95ede0a42c75e4e49))
* release please ([#72](https://github.com/dotennin/bili-webos/issues/72)) ([8bd0df2](https://github.com/dotennin/bili-webos/commit/8bd0df26b8258e5a60031e6927a53ac82c2c8747))
* **ui:** 3-column home grid and sidebar select-only navigation ([#23](https://github.com/dotennin/bili-webos/issues/23)) ([de0a560](https://github.com/dotennin/bili-webos/commit/de0a560d648d78d2f740878643adc628d32cb073))
* upgrade to React 19 and move browser dev proxy into Vite ([#71](https://github.com/dotennin/bili-webos/issues/71)) ([efa2e0b](https://github.com/dotennin/bili-webos/commit/efa2e0b39db24dc658000785140fc0aaa27d9b64))


### Bug Fixes

* **api:** avoid forcing Content-Type on proxy GET requests ([#14](https://github.com/dotennin/bili-webos/issues/14)) ([6a02b1b](https://github.com/dotennin/bili-webos/commit/6a02b1bdf43ee02ee9251b8d4e0630df6a6e1a0d))
* avoid selecting TV localhost proxy in browser without Luna bridge ([#37](https://github.com/dotennin/bili-webos/issues/37)) ([5ca1e78](https://github.com/dotennin/bili-webos/commit/5ca1e78524de0acc4df0f2359e0f921cbca75952))
* ensure thumbnails load on both web and webOS ([#29](https://github.com/dotennin/bili-webos/issues/29)) ([88dab49](https://github.com/dotennin/bili-webos/commit/88dab499f9b3096fd559008a59adf87324d1455e))
* guard Luna usage with PalmServiceBridge and fallback to proxy ([#27](https://github.com/dotennin/bili-webos/issues/27)) ([b3047c8](https://github.com/dotennin/bili-webos/commit/b3047c8efa1c6eebc1fc63124ffa46798e6b4f45))
* handle plain-text proxy responses without JSON parse failures ([#12](https://github.com/dotennin/bili-webos/issues/12)) ([94829a8](https://github.com/dotennin/bili-webos/commit/94829a89d8efc6fe3588bdefd00f7b7d455e97c9))
* include all JS/MJS source files in Bun coverage run ([#58](https://github.com/dotennin/bili-webos/issues/58)) ([d0ee005](https://github.com/dotennin/bili-webos/commit/d0ee005d4aa9a3d7e7a2914762efe371d7b562a3))
* make storage.remove safe in non-browser runtimes ([#15](https://github.com/dotennin/bili-webos/issues/15)) ([ba1d242](https://github.com/dotennin/bili-webos/commit/ba1d2425ce2d31b2f30fe7788ad8cbd5951b2c40))
* rerender settings page immediately after danmaku toggle ([#35](https://github.com/dotennin/bili-webos/issues/35)) ([9900668](https://github.com/dotennin/bili-webos/commit/99006684ebe7584301e67bdd090b47b6eb9d5452))
* SearchPage build error — replace missing VideoRow with VideoGrid ([#21](https://github.com/dotennin/bili-webos/issues/21)) ([844b8fc](https://github.com/dotennin/bili-webos/commit/844b8fc12295f971c8cce41f64f2b521055c2745))
* **wbi:** guard WBI key cache against clock rollback ([#59](https://github.com/dotennin/bili-webos/issues/59)) ([e906ed6](https://github.com/dotennin/bili-webos/commit/e906ed6654f6f94037f53388bd78d3c87b660ab6))
* **web:** use dynamic default proxy URL for browser dev ([#25](https://github.com/dotennin/bili-webos/issues/25)) ([b3bde44](https://github.com/dotennin/bili-webos/commit/b3bde44fb765f769840a684d3419c2ed049b9c8d))


### Performance Improvements

* **player:** reduce startup buffering and sync danmaku with first frame ([#11](https://github.com/dotennin/bili-webos/issues/11)) ([b489412](https://github.com/dotennin/bili-webos/commit/b48941241f12bfcb4449fb8c095b2995ba62fcfa))

## Changelog

This file is maintained by `release-please`.
