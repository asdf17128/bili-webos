# Candidate 2 暂停倍速回退故障

初次暂停状态下 native 2x → DASH 1x 观察到 time=0。为排除测试读取中间态，同一个安装包再次运行，增加 load 调用/resolve、媒体事件和 100ms 时间线，并在 loading 消失后最多等待目标定位 15 秒。

第二次仍失败：传给 Shaka 的 startTime=14.9，load 时旧 native 源 readyState=4；load 返回时新 DASH 为 time=0/readyState=0；随后 loadedmetadata/canplay 到达但没有 seeking/seeked，15 秒后仍暂停在 0。因而这是已复现的产品问题，不是原来固定 1 秒等待不足的误报。两次原始结果均保留，不能作为最终候选通过证据。

修复与最终真机结果稍后记录。
