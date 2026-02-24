import { BaseComponent } from "./BaseComponent.js";

export class CoolingFan extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 标准尺寸
        this.W = 160;
        this.H = 200;

        // ===== 核心状态 =====
        this.mode = "local";    // "local" 或 "remote"
        this.running = false;   // 运行开关状态
        this.power = 0;         // 实际转速 (0-1)
        this.targetPower = 0;   // 目标转速 (0-1)

        // ===== 初始化绘制 =====
        this._drawShell();
        this._drawPowerInput();
        this._drawTopPanel();
        this._drawFan();
        this._createPorts();

        // 移除了 _startLoop()，等待主程序驱动
    }

    /**
     * 核心受控更新函数
     * @param {number} pwm - 远程模式下的输入转速 (0-1)
     * @param {number} dt - 主程序传入的两帧间隔时间 (秒)
     */
    update(pwm, dt = 0.016) {
        // 1. 模式逻辑处理
        if (this.mode === "remote") {
            this.targetPower = Math.max(0, Math.min(1, pwm || 0));
            this.running = this.targetPower > 0.01;
        } else {
            // 本地模式：targetPower 由按钮点击直接控制
        }

        // 2. 模拟物理惯性 (电机起动与摩擦制动)
        // 起动时加速快(3.0)，停止时由于摩擦阻力减速稍慢(1.0)
        const lerpSpeed = this.targetPower > this.power ? 3.0 : 1.0;
        this.power += (this.targetPower - this.power) * lerpSpeed * dt;
        
        // 边界修正
        if (this.power < 0.001) this.power = 0;
        if (this.power > 0.999) this.power = 1;

        // 3. 执行视觉渲染更新
        this._renderVisuals(dt);
    }

    /**
     * 视觉刷新逻辑
     * @param {number} dt - 时间增量，用于计算旋转角度
     */
    _renderVisuals(dt) {
        // A. 计算旋转：满载时转速定义为每秒旋转 1500 度
        const maxRotationSpeed = 2000; 
        const rotationAmount = this.power * maxRotationSpeed * dt;
        this.fanGroup.rotate(rotationAmount);
        
        // B. 视觉残影效果：转得越快，叶片透明度越高，模拟高速模糊感
        this.fanGroup.opacity(Math.max(0.5, 1 - this.power * 0.4));

        // C. 更新控制面板灯光
        this.startBtn.fill(this.running ? "#00ff00" : "#0da30d");
        this.stopBtn.fill(!this.running ? "#ff0000" : "#9a0f0f");
        
        // 按钮发光反馈
        this.startBtn.shadowOpacity(this.running ? 0.6 : 0);
        this.stopBtn.shadowOpacity(!this.running ? 0.6 : 0);
    }

    _drawShell() {
        this.group.add(new Konva.Rect({
            width: this.W,
            height: this.H,
            stroke: "#333",
            strokeWidth: 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.W, y: this.H },
            fillLinearGradientColorStops: [0, '#e8e8e8', 1, '#bcbcbc'],
            cornerRadius: 4,
            shadowBlur: 8,
            shadowOpacity: 0.2
        }));
    }

    _drawPowerInput() {
        const inputGroup = new Konva.Group({ x: 0, y: 10 });
        const colors = ["#8B4513", "#4169E1"];
        [1, 2].forEach((i) => {
            const lineY = i * 15;
            inputGroup.add(new Konva.Line({
                points: [-25, lineY, 0, lineY],
                stroke: "#555",
                strokeWidth: 3
            }));
            inputGroup.add(new Konva.Circle({
                x: 0, y: lineY, radius: 4,
                fill: colors[i - 1], stroke: "#333", strokeWidth: 1
            }));
            inputGroup.add(new Konva.Text({
                x: 5, y: lineY - 5,
                text: i === 1 ? "L" : "N",
                fontSize: 9, fill: "#666", fontStyle: "bold"
            }));
        });
        this.group.add(inputGroup);
    }

    _drawTopPanel() {
        this.group.add(new Konva.Rect({
            width: this.W,
            height: 60,
            fill: "#cfcfcf",
            stroke: "#333",
            strokeWidth: 1,
            cornerRadius: { topLeft: 4, topRight: 4 }
        }));

        const selectorGroup = new Konva.Group({ x: 35, y: 32 });
        selectorGroup.add(new Konva.Text({ x: -22, y: -24, text: "LOC", fontSize: 9, fontStyle: 'bold' }));
        selectorGroup.add(new Konva.Text({ x: 8, y: -24, text: "REM", fontSize: 9, fontStyle: 'bold' }));

        this.knob = new Konva.Group({ cursor: 'pointer' });
        this.knob.add(new Konva.Circle({
            radius: 14,
            fillLinearGradientColorStops: [0, '#666', 1, '#111'],
            stroke: "#000", strokeWidth: 1
        }));
        this.knob.add(new Konva.Rect({ x: -2, y: -14, width: 4, height: 14, fill: "#fff", cornerRadius: 1 }));
        
        this.knob.rotation(this.mode === "local" ? -45 : 45);

        this.knob.on("click", () => {
            this.mode = this.mode === "local" ? "remote" : "local";
            this.targetPower = 0;
            this.running = false;
            this._updateSelectorUI();
        });
        selectorGroup.add(this.knob);
        this.group.add(selectorGroup);

        const btnY = 32;
        this.startBtn = new Konva.Circle({
            x: 95, y: btnY, radius: 14,
            fill: "#0a810a", stroke: "#000", strokeWidth: 2,
            shadowColor: "#00ff00", cursor: 'pointer'
        });
        this.startBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = true;
                this.targetPower = 1.0; // 本地控制转速为 1
                this.startBtn.y(btnY + 2);
            }
        });
        this.startBtn.on("mouseup mouseleave", () => this.startBtn.y(btnY));

        this.stopBtn = new Konva.Circle({
            x: 135, y: btnY, radius: 14,
            fill: "#871212", stroke: "#000", strokeWidth: 2,
            shadowColor: "#ff0000", cursor: 'pointer'
        });
        this.stopBtn.on("mousedown", () => {
            if (this.mode === "local") {
                this.running = false;
                this.targetPower = 0;
                this.stopBtn.y(btnY + 2);
            }
        });
        this.stopBtn.on("mouseup mouseleave", () => this.stopBtn.y(btnY));

        this.group.add(this.startBtn, this.stopBtn);
    }

    _updateSelectorUI() {
        const targetAngle = this.mode === "local" ? -45 : 45;
        if (this.knob.getLayer()) {
            new Konva.Tween({ node: this.knob, duration: 0.15, rotation: targetAngle }).play();
        } else {
            this.knob.rotation(targetAngle);
        }
    }

    _drawFan() {
        const centerX = this.W / 2;
        const centerY = 130;

        // 保护网罩
        this.group.add(new Konva.Circle({
            x: centerX, y: centerY, radius: 55,
            stroke: "#bbb", strokeWidth: 1, dash: [4, 4]
        }));

        this.fanGroup = new Konva.Group({ x: centerX, y: centerY });

        // 3 片叶子
        for (let i = 0; i < 3; i++) {
            this.fanGroup.add(new Konva.Ellipse({
                radiusX: 12, radiusY: 30,
                fill: "#222", stroke: "#000", strokeWidth: 1,
                rotation: i * 120,
                offsetY: 26,
                opacity: 0.9
            }));
        }

        // 中心轴
        this.fanGroup.add(new Konva.Circle({
            radius: 10,
            fillRadialGradientEndRadius: 10,
            fillRadialGradientColorStops: [0, '#eee', 0.4, '#888', 1, '#333']
        }));

        this.group.add(this.fanGroup);
    }

    _createPorts() {
        this.addPort(50, 0, "l", "wire");
        this.addPort(110, 0, "r", "wire");
    }

    destroy() {
        super.destroy();
    }
}