# 主题管理器标签联动开发接口文档 (Theme Manager Tag API Guide)

本文档面向 SillyTavern 的其他第三方扩展/插件开发者，介绍如何获取、检索以及监听本主题管理器（Theme Manager）中的主题标签（Theme Tags）信息。

本插件通过以下两种标准方式与外部代码进行通信：
1. **全局 API 接口 (`window.themeManager`)**：用于主动查询及注册回调函数。
2. **浏览器自定义事件 (`CustomEvent`)**：用于基于发布-订阅模式的事件监听。

---

## 1. 全局 API 接口 (`window.themeManager`)

当主题管理器成功加载并初始化后，会在全局 `window` 对象下注册 `themeManager` API。

### 1.1 获取所有标签列表 - `getTags()`

* **方法签名**：`getTags(): TagObject[]`
* **参数**：无
* **返回值**：`TagObject[]` — 当前创建的所有标签配置的数组。
* **数据结构**：
  ```typescript
  interface TagObject {
      id: string;      // 标签的唯一标识符 (例如: 'tag_1718712345678')
      name: string;    // 标签的显示名称 (例如: '动漫风格')
      themes: string[]; // 绑定了该标签的主题文件名/值列表 (例如: ['Azure.css', 'Chocolat.css'])
  }
  ```
* **调用示例**：
  ```javascript
  if (window.themeManager) {
      const tags = window.themeManager.getTags();
      console.log("全部标签数据:", tags);
  } else {
      console.warn("主题美化管理器扩展未加载或尚未初始化");
  }
  ```

---

### 1.2 获取特定主题绑定的标签 - `getThemeTags(themeName)`

* **方法签名**：`getThemeTags(themeName: string): string[]`
* **参数**：
  * `themeName` (string): 主题的文件名或内部选择值（例如当前处于激活状态的主题文件名 `Azure.css`，或可以通过 `#themes` 下拉框 value 获取的名字）。
* **返回值**：`string[]` — 返回该主题所绑定的**标签 ID** 列表。
* **调用示例**：
  ```javascript
  if (window.themeManager) {
      const activeTheme = document.querySelector('#themes').value;
      const tagIds = window.themeManager.getThemeTags(activeTheme);
      console.log(`当前激活主题 ${activeTheme} 的标签ID列表:`, tagIds);
  }
  ```

---

### 1.3 注册标签变更回调 - `onTagsChanged(callback)`

* **方法签名**：`onTagsChanged(callback: (tags: TagObject[]) => void): void`
* **参数**：
  * `callback` (function): 当标签库被更新、增加、删除或主题绑定关系改变时执行的回调函数，参数传入最新的 `TagObject[]`。
* **调用示例**：
  ```javascript
  if (window.themeManager) {
      window.themeManager.onTagsChanged((latestTags) => {
          console.log("检测到标签发生变更，更新插件视图：", latestTags);
          // 在此处执行您插件的 UI 重新渲染或数据同步逻辑
      });
  }
  ```

---

## 2. 浏览器自定义事件 (`CustomEvent`)

为了解耦组件通信，插件在每次保存标签库（新增标签、删除标签、修改关联等）时，都会在宿主环境的 `document` 上抛出标准的自定义事件。

### 2.1 事件名称：`themeManager:tagsChanged`

* **订阅对象**：`document`
* **事件载荷**：`event.detail` — 包含最新的 `TagObject[]`。
* **调用示例**：
  ```javascript
  document.addEventListener('themeManager:tagsChanged', (event) => {
      const latestTags = event.detail;
      console.log("接收到来自主题管理器的 tagsChanged 自定义事件通知:", latestTags);
      
      // 例如：检查某主题现在是否属于“黑暗模式”标签
      const darkTag = latestTags.find(t => t.name === '黑暗模式');
      if (darkTag && darkTag.themes.includes('MyFavoriteTheme.css')) {
          console.log('主题已标记为黑暗模式，更新关联 of 第三方组件皮肤...');
      }
  });
  ```

---

## 3. 开发实践与最佳实践

### 3.1 兼容性与加载顺序处理

由于 SillyTavern 插件是并行或异步初始化的，您的插件执行时本插件可能尚未加载完毕。为保证强健的可用性，建议采用以下方式做安全加载：

```javascript
(function() {
    function initMyPluginIntegration() {
        if (window.themeManager) {
            console.log("[MyPlugin] 成功接入主题管理器标签联动");
            
            // 首次读取
            const currentTags = window.themeManager.getTags();
            processTags(currentTags);
            
            // 订阅更新
            window.themeManager.onTagsChanged((updatedTags) => {
                processTags(updatedTags);
            });
        } else {
            // 如果尚未初始化，则每隔 200ms 重试，最长重试 5 秒
            let retries = 0;
            const checkInterval = setInterval(() => {
                retries++;
                if (window.themeManager) {
                    clearInterval(checkInterval);
                    initMyPluginIntegration();
                } else if (retries > 25) {
                    clearInterval(checkInterval);
                    console.log("[MyPlugin] 未检测到主题管理器标签接口，跳过集成。");
                }
            }, 200);
        }
    }

    function processTags(tags) {
        // 您的自定义业务逻辑...
    }

    // 监听文档就绪后加载
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initMyPluginIntegration();
    } else {
        document.addEventListener('DOMContentLoaded', initMyPluginIntegration);
    }
})();
```
