# 卸载与更新倍速失败的旧实现对照

生产 React PlayerPage 与生产 API，Shaka unload 和 Luna HTML5 响应受控；实际硬件解码另验。旧生产源码未改时，从 tools/test-player-loading.mjs 临时复制到 .release 并仅将 Vite 端口设为 5174，新增两种事件顺序：第一次取流成功→unload 等待→再次选 1.5x→新取流失败，分别在释放 unload 前/后失败。两项均没有第二次 DASH load，结果 0/2。

对应正式回归已整合进 tools/test-player-loading.mjs；新版完整专项见 ../speed-unload-verified/results.json，22/22（其中新增十一项）。初次增强夹具的鼠标被 loading 遮罩挡住、native 模式禁止画质操作等工具不适配结果保留于 speed-unload-after 与 speed-unload-after-final，不作为产品缺陷结论；最终使用实际遥控按键路径。
