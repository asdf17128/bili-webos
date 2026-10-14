首次两次真实选房请求未取得可用响应，结果保留；不算直播播放通过，也没有据此认定产品故障。之后增加选择探针的失败类别记录，同一已确认在播房间成功进入并执行耐久段。前两次记录只含空 code，不能事后补写精确根因。


## Candidate 3 的房间准备端点超时

三档画质房间 34348 已通过实际原画→蓝光→原画播放。随后独立准备探针的 `room_init` 一次失败，增加错误信息和一次有界重试后，两次均为 `Upstream timeout before response headers`，相应服务日志同样记录响应头超时；这些结果保留在 live-final3-room-probe-failure 和 live-final3-room-probe-retry-failure，不能删除或记作成功。

耐久选房改由实际视频播放器使用的 `getRoomPlayInfo` 验证 `code=0`、`live_status=1` 且存在媒体流。此处只改测试准备，不改生产网络请求；room_init 的异常仍列为残余网络观察。生产弹幕初始化仍调用 room_init，并有原来的房间 ID 回退，所以真实 token/订阅/聊天帧检查依然覆盖该等待，不以选房修改隐藏实际弹幕失败。
