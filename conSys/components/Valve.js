import { BaseComponent } from './BaseComponent.js';

export class Valve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.radius = 60; // 阀体主半径

        // --- 新增状态变量 ---
        this.controlMode = 'REMOTE'; // 'MANUAL' 或 'REMOTE'
        this.manualPos = 1.0;        // 手动模式下的开度
        this.remotePos = 1.0;        // 远程指令的开度
        this.currentPos = 1.0;       // 最终合成的实际开度
        this.isStuck = false; // 默认正常

        this.initValveChamber();
        this.initActuator();
        this.initRotaryVane();
        this.initHandwheel();        // 新增：初始化手轮
        this.initLCD();
        this.initModeSwitch();       // 新增：初始化手动/自动开关


        this.type = 'resistor';
        this.currentResistance = 250;

        // --- 端口定义 (严格对应弧形间隙位置) ---
        this.addPort(60, -10, 'r', 'pipe');    // 正上接口 (1段与2段间)
        this.addPort(-10, 60, 'u', 'pipe');    // 正左接口 (2段与3段间)
        this.addPort(60, 130, 'l', 'pipe');  // 正下接口 (3段与1段间)

        this.addPort(175, 40, 'l', 'wire', 'p');  // 电机正极
        this.addPort(175, 80, 'r', 'wire');  // 电机负极

        // 双击清除卡死故障
        this.group.on('dblclick', () => {
            if (this.isStuck) this.isStuck = false;
            try { this.sys.layer.batchDraw(); } catch (e) { }
        });
    }

    /**
     * 1. 绘制三段弧组成的腔体
     */
    initValveChamber() {
        this.chamberGroup = new Konva.Group({ x: 60, y: 60 });
        const arcStroke = '#2c3e50';
        const strokeW = 15;

        // 第1段：右侧 (正上到正下) -> -90度 到 90度
        const arc1 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 140, rotation: -70, // 留出上下开口的间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道上接口
        const arcup = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: -110, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcup2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: -110, // 留出上下开口的间隙
            stroke: '#bdc2cb', strokeWidth: strokeW - 4
        });

        // 第2段：左上 (正上到正左) -> 180度 到 270度
        const arc2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 50, rotation: 200, // 留出上口和左口间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道左接口
        const arcleft = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 160, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcleft2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 160, // 留出上下开口的间隙
            stroke: '#e2e5ed', strokeWidth: strokeW - 4
        });
        // 第3段：左下 (正左到正下) -> 90度 到 180度
        const arc3 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 50, rotation: 110, // 留出左口和下口间隙
            stroke: arcStroke, strokeWidth: strokeW
        });
        // 管道下接口
        const arcdown = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 70, // 留出上下开口的间隙
            stroke: '#f1c7c7', strokeWidth: strokeW + 6
        });
        const arcdown2 = new Konva.Arc({
            innerRadius: this.radius, outerRadius: this.radius,
            angle: 40, rotation: 70, // 留出上下开口的间隙
            stroke: '#e2e5ed', strokeWidth: strokeW - 4
        });
        this.chamberGroup.add(arc1, arcup, arcup2, arc2, arcleft, arcleft2, arc3, arcdown, arcdown2);
        this.group.add(this.chamberGroup);
    }

    /**
     * 2. 绘制电机驱动机构
     */
    initActuator() {
        const box = new Konva.Rect({
            x: 115, y: 20, width: 60, height: 80,
            fill: '#34495e', stroke: '#000', cornerRadius: 5
        });

        // 电机矢量符号 (圆圈 + M)
        const motorIcon = new Konva.Circle({ x: 145, y: 60, radius: 20, fill: '#ecf0f1', stroke: '#2c3e50' });
        const mText = new Konva.Text({ x: 138, y: 54, text: 'M', fontSize: 18, fontStyle: 'bold' });
        const labelText = new Konva.Text({ x: 100, y: 118, text: '三通调节阀', fontSize: 18, fontStyle: 'bold' })

        this.group.add(box, motorIcon, mText, labelText);
    }

    /**
     * 3. 绘制旋转扇形阀板
     */
    initRotaryVane() {
        // 阀板容器，中心点在 (60, 60)
        this.vaneGroup = new Konva.Group({ x: 60, y: 60 });

        // 扇形阀板 (橙色)
        // 跨度90度，正好可以遮住一个象限的开口
        this.vane = new Konva.Wedge({
            x: 0, y: 0,
            radius: this.radius - 10,
            angle: 90,
            fill: '#06a844',
            stroke: '#d35400',
            strokeWidth: 1,
            rotation: 100 // 初始位置
        });

        // 中心轴
        const pivot = new Konva.Circle({ radius: 8, fill: '#7f8c8d', stroke: '#000' });
        this.vaneGroup.add(this.vane, pivot);
        this.group.add(this.vaneGroup);
    }

    /**
     * 4. 绘制液晶显示屏 (LCD)
     */
    initLCD() {
        const lcdX = 35;
        const lcdY = 15; // 位于中心上方一点

        // 液晶屏背景框
        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY,
            width: 50, height: 22,
            fill: '#1a1a1a',
            stroke: '#7f8c8d',
            strokeWidth: 1,
            cornerRadius: 2
        });

        // 液晶屏数字显示
        this.lcdText = new Konva.Text({
            x: lcdX, y: lcdY + 4,
            width: 50,
            text: '100%',
            fontSize: 14,
            fontFamily: 'Courier New', // 模拟数码管感
            fontStyle: 'bold',
            fill: '#00ff00', // 荧光绿
            align: 'center',
            shadowColor: '#00ff00',
            shadowBlur: 5,
            shadowOpacity: 0.5
        });

        this.group.add(lcdBg, this.lcdText);
    }

    /**
     * 新增：绘制手轮并绑定拖拽旋转逻辑
     */
    initHandwheel() {
        this.wheelGroup = new Konva.Group({ x: 60, y: 60 });

        // 绘制手轮 (保持原样)
        const wheelRim = new Konva.Circle({ radius: 25, stroke: '#95a5a6', strokeWidth: 5, fill: '#bdc3c7' });
        const spoke1 = new Konva.Line({ points: [0, -20, 0, 20], stroke: '#7f8c8d', strokeWidth: 3 });
        const spoke2 = new Konva.Line({ points: [-20, 0, 20, 0], stroke: '#7f8c8d', strokeWidth: 3 });
        const knob = new Konva.Circle({ x: 18, y: 0, radius: 3, fill: '#e74c3c' });

        this.wheelGroup.add(wheelRim, spoke1, spoke2, knob);
        this.group.add(this.wheelGroup);

        // --- 点击交互逻辑 ---
        this.wheelGroup.on('click', (e) => {
            if (this.controlMode !== 'MANUAL') return;

            // 获取鼠标点击相对于手轮中心 (0,0) 的相对坐标
            const pointer = this.wheelGroup.getRelativePointerPosition();

            // y < 0 为上半部分，y > 0 为下半部分
            if (pointer.y < 0) {
                // 点击上半部分：顺时针旋转，开度增大
                this.manualPos = Math.min(1.0, this.manualPos + 0.05);
            } else {
                // 点击下半部分：逆时针旋转，开度减小
                this.manualPos = Math.max(0.0, this.manualPos - 0.05);
            }

            this.update(); // 触发 UI 更新
        });
    }

    /**
     * 新增：手动/远程切换开关
     */
    initModeSwitch() {
        const swGroup = new Konva.Group({ x: 127, y: 0 });
        const base = new Konva.Rect({ width: 40, height: 20, fill: '#2c3e50', cornerRadius: 10 });
        this.toggleHandle = new Konva.Circle({ x: 30, y: 10, radius: 8, fill: '#0bf555' });
        this.modeLabel = new Konva.Text({ x: -4, y: -12, text: 'REMOTE', fontSize: 10, fill: '#2d09f8', fontstyle: 'bold', width: 50, align: 'center' });

        swGroup.add(base, this.toggleHandle, this.modeLabel);
        this.group.add(swGroup);

        swGroup.on('click', () => {
            if (this.controlMode === 'REMOTE') {
                // --- 远程转手动 ---
                this.controlMode = 'MANUAL';
                // 保持同步：手动模式的初始值等于当前的远程值
                this.manualPos = this.remotePos;

                this.toggleHandle.x(10);
                this.toggleHandle.fill('#f1c40f');
                this.modeLabel.text('MANUAL');
            } else {
                // --- 手动转远程 ---
                this.controlMode = 'REMOTE';
                // 保持同步：将手动的最后开度同步给远程逻辑（视控制系统逻辑而定，这里确保位置一致）
                this.remotePos = this.manualPos;

                this.toggleHandle.x(30);
                this.toggleHandle.fill('#0dfd49');
                this.modeLabel.text('REMOTE');
            }
            this.update();
        });
    }
    updateModeText(mode) {
        if (mode === 'MANUAL') {
            this.toggleHandle.x(10);
            this.toggleHandle.fill('#f1c40f');
            this.modeLabel.text('MANUAL');
        } else {
            this.toggleHandle.x(30);
            this.toggleHandle.fill('#0dfd49');
            this.modeLabel.text('REMOTE');
        }
    }
    /**
     * 更新阀门位置
     * @param {number} pos 0.0 - 1.0
     */
    update(inputPos) {

        if (this.isStuck) {
            // 如果卡死，无论外部传入什么 inputPos，都不更新 currentPos
            // 液晶屏可以闪烁显示当前开度以示异常
            this.lcdText.fill(Math.floor(Date.now() / 500) % 2 ? '#ff0000' : '#7f8c8d');
            this.sys.layer.batchDraw();
            return;
        }
        // 1. 如果是远程模式且有外部输入，更新远程值
        if (this.controlMode === 'REMOTE' && typeof inputPos === 'number') {
            this.remotePos = inputPos;
        }

        // 2. 确定当前实际显示的开度
        this.currentPos = (this.controlMode === 'MANUAL') ? this.manualPos : this.remotePos;

        const safePos = Math.max(0, Math.min(1, this.currentPos));
        const percent = Math.round(safePos * 100);

        // 3. 旋转角度映射 (阀板与手轮同步旋转)
        const startRotation = 110;
        const endRotation = 70;
        const currentRotation = endRotation + (safePos * (startRotation - endRotation));

        this.vane.rotation(currentRotation);
        this.wheelGroup.rotation(currentRotation * 5.5); // 手轮旋转角度可以设大一点，增加操作感

        // 4. LCD 与 颜色反馈
        this.lcdText.text(percent + "%");
        this.lcdText.fill(percent > 10 ? '#00ff00' : '#ff3300');

        const color = safePos > 0.1 ? '#11ed65' : '#fa3b25';
        this.vane.fill(color);

        this.sys.layer.batchDraw();
    }
}