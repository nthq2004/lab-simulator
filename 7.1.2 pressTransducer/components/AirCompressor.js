import { BaseComponent } from "./BaseComponent.js";

export class AirCompressor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 尺寸调整以适应 V 型结构
        this.W = 200;
        this.H = 220;

        // ===== 核心状态 =====
        this.mode = "local";    // "local" 或 "remote"
        this.running = false;   // 运行状态
        this.power = 0;         // 实际转速 (0-1)
        this.targetPower = 0;   // 目标转速 (0-1)
        this.crankAngle = 0;    // 曲轴转角
        this.type = 'airCompressor';

        // ===== 初始化绘制 =====
        this._drawShell();       // 底座与外壳
        this._drawCylinders();   // V型双缸
        this._drawTopControlPanel(); // 顶部模式切换、启动和停止按钮
        this._createPorts();
        this._startLoop();
    }


    _startLoop() {
        this.timer = setInterval(() => {

            if (this.mode === "remote") {
                const beConnected = this.sys.isPortConnected(`${this.id}_wire_l`, `${this.id}_wire_r`);
                this.targetPower = beConnected === true ? 1.0 : 0;
                this.running = this.targetPower > 0;
            }
            const dt = 0.2;
            // 模拟物理惯性
            const lerpSpeed = this.targetPower > this.power ? 0.25 : 0.12;
            this.power += (this.targetPower - this.power) * lerpSpeed * dt;
            if (this.power < 0.01) this.power = 0;

            // 更新动画角度
            this.crankAngle += this.power * 200 * dt;

            this._renderVisuals();
        }, 200);
    }

    _renderVisuals() {
        // 1. 活塞往复运动 (V型 90度夹角相位差)
        this.cyls.forEach((cyl, i) => {
            const phase = i * 90 * (Math.PI / 180);
            const rad = (this.crankAngle * Math.PI / 180) + phase;
            const travel = Math.sin(rad) * 18; // 往复行程

            cyl.piston.y(cyl.originY + travel);
            // 连杆小幅度摆动
            cyl.rod.points([0, 0, -Math.cos(rad) * 8, -45 + travel]);
        });

        // 2. 更新启动和停止按钮颜色状态
        this.onBtn.fill(this.running ? "#00ff00" : "#006400"); // 亮绿色为启动，深绿色为停止
        this.offBtn.fill(this.running ? "#8b0000" : "#ff0000"); // 红色表示停止状态
    }

    _drawShell() {
        // 主机座
        this.group.add(new Konva.Rect({
            width: this.W, height: this.H,
            fill: '#d1d1d1', stroke: '#444', strokeWidth: 2, cornerRadius: 5
        }));
        // 黑色曲轴箱
        this.crankcase = new Konva.Rect({
            x: 40, y: 110, width: 120, height: 90,
            fill: '#222', stroke: '#000', cornerRadius: 10
        });
        this.group.add(this.crankcase);
    }

    _drawCylinders() {
        this.cyls = [];
        const centerX = 100;
        const centerY = 155;
        const angles = [-45, 45]; // V型角度

        angles.forEach((angle) => {
            const g = new Konva.Group({ x: centerX, y: centerY, rotation: angle });

            // 气缸体
            g.add(new Konva.Rect({
                x: -25, y: -90, width: 50, height: 75,
                fill: '#555', stroke: '#333', cornerRadius: 2
            }));

            // 连杆跟活塞相连
            const rod = new Konva.Line({
                points: [0, 0, 0, 45], stroke: '#888', strokeWidth: 5, lineCap: 'round'
            });

            const piston = new Konva.Rect({
                x: -20, y: -75, width: 40, height: 25,
                fill: '#aaa', stroke: '#444', cornerRadius: 2
            });

            g.add(rod, piston);
            this.group.add(g);
            this.cyls.push({ piston, rod, originY: -75 });
        });

        // 曲轴中心盖
        this.group.add(new Konva.Circle({
            x: centerX, y: centerY, radius: 20,
            fillRadialGradientColorStops: [0, '#666', 1, '#222']
        }));
    }

    _drawTopControlPanel() {
        const panelGroup = new Konva.Group({ x: 0, y: 15 });

        // 定义水平间距，实现等距分布
        const startX = 40;  // 起始位置
        const spacing = 60; // 组件之间的间距
        const centerY = 25; // 组件垂直中心线
        const labelY = 22;  // 文字相对于组件中心的偏移量

        // 1. 模式切换旋钮 (左侧)
        const knobGroup = new Konva.Group({ x: startX, y: centerY, cursor: 'pointer' });
        knobGroup.add(new Konva.Circle({ radius: 15, fill: '#444', stroke: '#000', strokeWidth: 1 }));
        knobGroup.add(new Konva.Rect({ x: -2, y: -15, width: 4, height: 12, fill: '#fff', cornerRadius: 1 }));
        knobGroup.rotation(this.mode === 'local' ? -45 : 45);

        knobGroup.on('click', () => {
            this.mode = this.mode === 'local' ? 'remote' : 'local';
            this.targetPower = 0;
            this.running = false;
            new Konva.Tween({ node: knobGroup, duration: 0.2, rotation: this.mode === 'local' ? -45 : 45 }).play();
        });

        // 旋钮标注
        panelGroup.add(new Konva.Text({ x: startX - 35, y: centerY - 5, text: "LOC", fontSize: 10, fontStyle: 'bold' }));
        panelGroup.add(new Konva.Text({ x: startX + 20, y: centerY - 5, text: "REM", fontSize: 10, fontStyle: 'bold' }));
        panelGroup.add(knobGroup);

        // 2. ON 圆形按钮 (中间)
        const onGroup = new Konva.Group({ x: startX + spacing, y: centerY });
        this.onBtn = new Konva.Circle({
            radius: 14,
            fill: '#006400', // 默认深绿
            stroke: '#000',
            strokeWidth: 1,
            cursor: 'pointer',
            shadowBlur: 5,
            shadowColor: '#00ff00',
            shadowOpacity: 0
        });

        const onText = new Konva.Text({
            x: -8, y: labelY,
            text: "ON", fontSize: 11, fontStyle: 'bold', fill: "#333"
        });

        onGroup.on('click', () => {
            if (this.mode === "local") {
                this.running = true;
                this.targetPower = 1.0;
            }
        });

        onGroup.add(this.onBtn, onText);
        panelGroup.add(onGroup);

        // 3. OFF 圆形按钮 (右侧)
        const offGroup = new Konva.Group({ x: startX + spacing * 2, y: centerY });
        this.offBtn = new Konva.Circle({
            radius: 14,
            fill: '#dc3545', // 默认亮红
            stroke: '#000',
            strokeWidth: 1,
            cursor: 'pointer'
        });

        const offText = new Konva.Text({
            x: -11, y: labelY,
            text: "OFF", fontSize: 11, fontStyle: 'bold', fill: "#333"
        });

        offGroup.on('click', () => {
            if (this.mode === "local") {
                this.running = false;
                this.targetPower = 0;
            }
        });

        offGroup.add(this.offBtn, offText);
        panelGroup.add(offGroup);

        this.group.add(panelGroup);
    }

    _createPorts() {
        // 电气接口
        this.addPort(70, 0, "l", "wire");
        this.addPort(130, 0, "r", "wire");

        // 气路接口
        this.addPort(0, 180, "i", "pipe", 'in');  // 左侧吸气
        this.addPort(this.W, 180, "o", "pipe"); // 右侧排气
    }
}