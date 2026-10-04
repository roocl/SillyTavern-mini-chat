# 开发索引

- 安装与使用：[README](../README.md)。
- 扩展入口与版本：[manifest.json](../manifest.json)。
- 酒馆集成、小窗生命周期和控件：[index.js](../index.js)。
- 消息文档、输入桥接与资源释放：[message-view.js](../message-view.js)。
- 操作互斥与输入尺寸：[session.js](../session.js)。
- 消息格式化、发送桥接及主题变量：[core.js](../core.js)。

## 验证

本地回归样例位于被 Git 忽略的 tests 目录。浏览器回归使用 Playwright 驱动 Edge 和真实 Document PiP；酒馆接口由本地测试页面提供，不能替代目标酒馆实例的插件组合验收。

运行定向回归：

```powershell
node --test --experimental-test-isolation=none tests/session.test.mjs tests/browser.test.mjs
```
