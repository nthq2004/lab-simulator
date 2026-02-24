import { BaseComponent } from './BaseComponent.js';

export class Transmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 动态尺寸设置：最小宽140, 最小高180
        this.width = Math.max(140, Math.min(config.width || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));

        this.zeroAdj = 0;
        this.spanAdj = 1.0;
        this.rangeMax = 100;
        this.isOpened = false; // 默认电路闭合（正常）    

        this.knobs = [];
        this._init();

        // this.group.add();
        this.addPort(40, 168, 'l', 'wire');
        this.addPort(70, 168, 'm', 'wire');
        this.addPort(100, 168, 'r', 'wire');
        this.addPort(140, 18, 'p', 'wire', 'p');
        this.addPort(140, 48, 'n', 'wire');

        // 双击清除开路故障
        this.group.on('dblclick', () => {
            if (this.isOpened) this.isOpened = false;
            try { this.sys.layer.batchDraw(); } catch (e) {}
        });
    }

    _init() {
        this._drawEnclosure();      // 绘制主体仓位
        this._drawLCD();            // 绘制显示屏
        this._drawKnobs();          // 绘制拟物旋钮


    }
    _drawEnclosure() {
        const centerX = this.width / 2;

        // 1. 顶部 T 型横梁 (Junction Box)
        const labelText = new Konva.Text({ x: 22, y: -10, width: this.w, text: '温度变送器', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' });
        const tBar = new Konva.Rect({
            x: 20, y: 10,
            width: this.width - 40, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5
        });

        // 左右金属密封盖 (模拟图片两侧的六角螺帽)
        const leftCap = new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });
        const rightCap = new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });

        // 2. 圆形表头与防滑旋盖 (深绿色)
        const outerRadius = 55;
        const outerCover = new Konva.Circle({
            x: centerX, y: 85, radius: outerRadius,
            fill: '#2f3542', // 底色
            stroke: '#1e272e', strokeWidth: 1
        });

        // 深绿色旋盖 (带凹槽纹理)
        const greenCover = new Konva.Circle({
            x: centerX, y: 85, radius: 52,
            fill: '#27ae60', // 图片中的深绿色
            stroke: '#1e8449', strokeWidth: 4
        });

        // 3. 底部金属丝扣接口
        const stem = new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 10, fill: '#ced6e0', stroke: '#747d8c' });
        const bolt = new Konva.Rect({ x: centerX - 45, y: 150, width: 90, height: 20, fill: '#747d8c', cornerRadius: 2 });

        this.group.add(tBar, leftCap, rightCap, outerCover, greenCover, stem, bolt, labelText);
        this.lcdCenterY = 85;
    }

    _drawLCD() {
        const centerX = this.width / 2;
        const lcdRadius = 38;

        // LCD 背景 (图片中是弧形顶部的绿色屏幕)
        this.lcdBg = new Konva.Circle({
            x: centerX, y: this.lcdCenterY,
            radius: lcdRadius,
            fill: '#000' // 默认黑屏
        });

        this.lcdText = new Konva.Text({
            x: centerX - 30, y: this.lcdCenterY - 10,
            width: 60,
            text: '',
            fontSize: 18,
            fontFamily: 'Digital-7, monospace',
            fill: '#00ff00',
            align: 'center',
            fontStyle: 'bold'
        });

        const unit = new Konva.Text({
            x: centerX - 15, y: this.lcdCenterY + 12,
            text: 'MPa', fontSize: 10, fill: '#1a1a1a', opacity: 0
        });
        this.unitText = unit;

        this.group.add(this.lcdBg, this.lcdText, unit);
    }

    _drawKnobs() {
        // 旋钮放在顶部 T 型梁上，模拟隐藏盖板下的调节孔
        const knobConfigs = [
            { id: 'zero', x: 50, label: 'Z' },
            { id: 'span', x: this.width - 50, label: 'S' }
        ];

        knobConfigs.forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            const base = new Konva.Circle({ radius: 11, fill: '#dfe4ea', stroke: '#747d8c' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));

            knobGroup.add(base, rotor);
            this.knobs[k.id] = rotor; // 存储旋钮对象

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.8;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.5;
                };
                const onUp = () => {
                    // const val = (this.inputTemp + this.zeroAdj) * this.spanAdj;
                    // //压力换算成电流，最小对应4mA，最大对应20mA。
                    // this.outCurrent = Math.min(Math.max((val / this.rangeMax) * 16 + 4, 3.8), 20.8);
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    window.removeEventListener('touchend', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup', onUp);
                window.addEventListener('touchend', onUp);
            });
            this.group.add(knobGroup);
        });
    }
    update(state) {
        // state: { powered: bool, transCurrent: number }
        // --- 核心修改：开路故障检查 ---
        // 如果开路被设置，或者 state 明确表示断电
        if (this.isOpened || !state || !state.powered) {
            try {
                this.lcdText.text('');
                this.unitText.text('');
                this.lcdBg.fill('#000'); // 黑屏
                this.unitText.opacity(0);
            } catch (e) { }

            this.sys.layer.batchDraw();
            return;
        }

        // 1. 获取输入电流值
        const inCurrent = (typeof state.transCurrent === 'number') ? state.transCurrent : 0;

        // 2. 根据电流推算原始温度 (4-20mA -> 0-rangeMax)

        const tempDisp = ((inCurrent - 4) / 16) * this.rangeMax;

        // 4. 处理显示逻辑与输出电流
        let displayText = "";
        let isFault = false;

        if (inCurrent < 4.0) {
            // 小于 4mA 显示 LLLL
            displayText = "LLLL";
            isFault = true;
        } else if (inCurrent > 20.0) {
            // 大于 20mA 显示 HHHH
            displayText = "HHHH";
            isFault = true;
        } else {
            // 正常量程内：显示数值
            displayText = tempDisp.toFixed(1);
            // 变送器输出跟随输入电流（或根据修正后的温度重新映射）
            isFault = false;
        }

        // 5. 更新 UI 表现
        if (isFault) {
            this.lcdText.fill('#ff4757'); // 故障显示红色
            this.lcdText.text(displayText);
            this.unitText.opacity(0);      // 故障时不显示单位
            this.lcdBg.fill('#2f3542');    // 背景变暗
        } else {
            this.lcdText.fill('#1a1a1a');  // 正常显示黑色
            this.lcdText.text(displayText);
            this.unitText.opacity(1);
            this.unitText.text('°C');
            this.lcdBg.fill('#2ed573');    // 正常显示翠绿色
        }

        this.sys.layer.batchDraw();
    }
}