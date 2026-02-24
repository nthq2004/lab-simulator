import { BaseComponent } from './BaseComponent.js';

/**
 * Pump - 带有集成控制箱的水泵组件
 * 视觉特征：整体外框、三叶片叶轮、控制箱内居中启停按钮（带灯）
 */
export class Pump extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        
        // --- 1. 尺寸与布局定义 ---
        this.totalW = 160;   // 整体底座宽度
        this.totalH = 100;   // 整体底座高度
        this.boxW = 60;      // 左侧控制箱宽度
        this.pumpOffX = 35;  // 泵体相对于中心的偏移

        this.initMainFrame();  // 初始化整体外框
        this.initControlBox(); // 初始化控制箱及居中按钮
        this.initPumpBody();   // 初始化泵体与三叶片叶轮
        
        // --- 2. 端口定义 ---
        // 端口位置相对于 group 中心，确保与泵壳边缘对齐
        this.addPort(this.pumpOffX, -50, 'in', 'pipe');  
        this.addPort(this.pumpOffX, 50, 'out', 'pipe');  
    }

    /**
     * 绘制包络矩形底座
     */
    initMainFrame() {
        const labelText = new Konva.Text({ x: -this.totalW / 2+5, y: -this.totalH / 2-20, width: this.w, text: '高温淡水泵', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });
        this.mainFrame = new Konva.Rect({
            x: -this.totalW / 2,
            y: -this.totalH / 2,
            width: this.totalW,
            height: this.totalH,
            fill: '#564b4b',
            stroke: '#7f8c8d',
            strokeWidth: 1,
            cornerRadius: 5,
            shadowBlur: 5,
            shadowOpacity: 0.1
        });
        this.group.add(labelText,this.mainFrame);
    }

    /**
     * 初始化控制箱：按钮居中分布
     */
    initControlBox() {
        const xPos = -this.totalW / 2 + 5; // 靠左放置
        const yPos = -this.totalH / 2 + 5;
        const boxH = this.totalH - 10;

        // 控制箱背景（深灰色面板）
        const boxPanel = new Konva.Rect({
            x: xPos, y: yPos,
            width: this.boxW, height: boxH,
            fill: '#8d949b',
            cornerRadius: 3
        });
        this.group.add(boxPanel);

        // 按钮垂直居中算法
        // 在 boxH 高度内平分空间给两个按钮
        const centerY = yPos + boxH / 2;
        const spacing = 25; // 按钮中心间距

        // 启动按钮 (位于中心点上方)
        this.btnStart = this.createLightButton({
            x: xPos + this.boxW / 2+15,
            y: centerY - spacing,
            color: '#27ae60',
            text: '启动',
            fontSize:16,
            onClick: () => { this.sys.state.pumpOn = true; }
        });

        // 停止按钮 (位于中心点下方)
        this.btnStop = this.createLightButton({
            x: xPos + this.boxW / 2+15,
            y: centerY + spacing,
            color: '#e74c3c',
            text: '停止',
            onClick: () => { this.sys.state.pumpOn = false; }
        });

        this.group.add(this.btnStart.node, this.btnStop.node);
    }

    /**
     * 内部方法：创建带指示灯的按钮（文字在按钮左侧）
     */
    createLightButton({ x, y, color, text, onClick }) {
        const btnGroup = new Konva.Group({ x, y });
        
        // 按钮圆形主体
        const btnCircle = new Konva.Circle({
            radius: 11,
            fill: '#bdc3c7',
            stroke: '#000',
            strokeWidth: 1
        });

        // 状态指示灯（位于按钮中间）
        const light = new Konva.Circle({
            radius: 7,
            fill: '#333'
        });

        // 文字标签（靠左居中）
        const label = new Konva.Text({
            x: -38, y: -5,
            text: text,
            fontSize: 12,
            fill: '#ecf0f1',
            fontStyle: 'bold'
        });

        btnGroup.add(label, btnCircle, light);

        // 点击交互
        btnGroup.on('mousedown', () => {
            btnCircle.scale({ x: 0.9, y: 0.9 });
            onClick();
            this.sys.layer.draw();
        });
        btnGroup.on('mouseup mouseleave', () => {
            btnCircle.scale({ x: 1, y: 1 });
        });

        return { node: btnGroup, light, color };
    }

    /**
     * 初始化泵体及三叶片叶轮
     */
/**
     * 初始化泵体及高级三叶片叶轮
     */
    initPumpBody() {
        this.pumpGroup = new Konva.Group({ x: this.pumpOffX, y: 0 });

        // 1. 泵壳底座（深色背景增强对比）
        this.shell = new Konva.Circle({
            radius: 35,
            fill: '#ecf0f1',
            stroke: '#34495e',
            strokeWidth: 3,
            shadowColor: 'black',
            shadowBlur: 2,
            shadowOffset: { x: 1, y: 1 },
            shadowOpacity: 0.2
        });

        // 2. 叶轮组
        this.impeller = new Konva.Group();
        
        // 中心轴毂
        const hub = new Konva.Circle({
            radius: 6,
            fill: '#7f8c8d',
            stroke: '#2c3e50',
            strokeWidth: 1
        });

        // 生成三个弧形叶片
        for (let i = 0; i < 3; i++) {
            // 使用 Path 绘制具有厚度和弧度的叶片
            // M 0,0 (中心起点)
            // Q -15,-15 -5,-28 (左侧弧线)
            // L 5,-28 (顶部尖端)
            // Q 10,-10 0,0 (右侧回流弧线)
            const blade = new Konva.Path({
                data: 'M 0,0 Q -12 -15 -4 -30 L 4 -30 Q 8 -10 0 0 Z',
                fillLinearGradientStartPoint: { x: -5, y: -30 },
                fillLinearGradientEndPoint: { x: 5, y: 0 },
                fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#95a5a6', 1, '#7f8c8d'],
                stroke: '#2c3e50',
                strokeWidth: 1,
                rotation: i * 120,
                lineJoin: 'round'
            });
            this.impeller.add(blade);
        }

        this.impeller.add(hub);
        this.pumpGroup.add(this.shell, this.impeller);
        this.group.add(this.pumpGroup);
    }

    /**
     * 仿真更新
     */
    update(isOn) {
        if (isOn) {
            // 叶轮旋转
            this.impeller.rotate(30);
            this.shell.stroke('#3498db');

            // 按钮灯光状态：启动亮，停止暗
            this.btnStart.light.fill(this.btnStart.color);
            this.btnStart.light.shadowColor(this.btnStart.color);
            this.btnStart.light.shadowBlur(10);

            this.btnStop.light.fill('#333');
            this.btnStop.light.shadowBlur(0);
        } else {
            this.shell.stroke('#34495e');

            // 按钮灯光状态：启动暗，停止亮
            this.btnStart.light.fill('#333');
            this.btnStart.light.shadowBlur(0);

            this.btnStop.light.fill(this.btnStop.color);
            this.btnStop.light.shadowColor(this.btnStop.color);
            this.btnStop.light.shadowBlur(10);
        }
    }
}