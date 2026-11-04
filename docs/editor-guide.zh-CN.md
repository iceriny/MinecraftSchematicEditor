# 编辑器使用指南

[English reference](editor-guide.md) | 简体中文

## 打开和移动

在本地服务运行后打开 <http://127.0.0.1:5173>。拖入投影文件打开建筑，New 创建空白画布。Open in a tab 将第二座建筑放到独立文档，Shift 拖入则把它送入剪贴板。

拖动旋转视角，右键拖动平移，滚轮缩放，F 对准整栋建筑。选中编辑工具后左键用于编辑，旋转改用右键。G 切换步行视角，WASD 移动，Space／Shift 升降，R 加速，Esc 返回旋转视角。

右侧图层滑块隐藏高处方块，用来逐层检查建筑。每个文档保留自己的选区、图层和撤销历史。当前活动文档会自动暂存到浏览器，文件导出使用 Save。

## 工具与快捷键

| 键 | 操作 |
| --- | --- |
| V | 移动 |
| P / E / B | 放置、擦除、涂色 |
| Alt + 点击 / I | 吸取方块材料 |
| H | 拖出一片地板 |
| U | 推移画笔内的方块 |
| S | 两点规划楼梯 |
| M / X | 方框选区、穿透框选 |
| K | 两点测量 |
| C | 克隆剪贴板 |
| 1–9 | 快捷栏选材料 |
| R / Shift + R | 旋转／翻转材料 |
| L | 锁定在图层平面上放置 |
| [ / ] | 调整图层高度 |
| Ctrl + A / C / X / V | 全选、复制、剪切、粘贴 |
| Ctrl + Z / Ctrl + Shift + Z | 撤销／重做 |

Paint 面板可选择方向、上下半部等 blockstate 属性。画笔有尺寸和形状选项，Mirror 可以按轴对称。Selection 的填充支持实体、空心、墙面、边框和只填空气。

Clipboard 中可以旋转和镜像副本，并设置是否写入空气。Page Up／Page Down 可以升降悬空预览。Canvas 可从六个方向扩张或裁切，Crop to blocks 收紧到实际建筑边界。

## 材质与模组

本地 Vite 服务发现已安装的 Minecraft 版本和模组实例。顶部菜单选择版本材质，再按建筑需要加载模组 JAR。也可手动添加客户端 JAR 或资源包 ZIP。资源保存在当前浏览器的缓存中。

自定义目录通过 `MINECRAFT_DIR` 和 `MINECRAFT_INSTANCES` 设置。Windows 的本机 JSON 设置方式见 [启动说明](windows.zh-CN.md)。

渲染器读取方块状态、模型和纹理。动画使用首帧，色调使用固定生物群系颜色。由游戏代码绘制的箱子、床、告示牌等方块实体可能显示为近似方盒。

## 文件与 Agent

可读 `.litematic`、`.schem`、旧式 `.schematic` 和结构 `.nbt`。可导出 `.litematic`、`.schem`、`.nbt`。多区域 Litematica 文件载入后合并，保存为单区域。

Agent 可以直接调用 [MCP](../mcp/README.zh-CN.md) 修改建筑、生成剖面并保存文件。12 个工具与使用模式由 [Skill](../skills/minecraft-schematic-editor/SKILL.md) 说明。

完整模型解析流程、源码布局与细节保留在 [英文参考手册](editor-guide.md) 中。
