import { BaseComponent } from './BaseComponent.js';

export class Engine extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 严格尺寸控制
        this.w = 240;
        this.h = 180;

        this.pistons = [];
        this.rods = [];
        this.crankWebs = [];
        this.crankShafts = [];
        this.flames = []; // 存储火焰引用

        this.fuelRate = 0.7; // 初始喷油量（负荷），范围 0.1 - 1.0

        this.initVisuals();
        this.initControlSwitch();
        this.initFuelKnob(); // 新增：初始化喷油旋钮

        // --- 调整后的端口位置 ---
        // 冷却水进口：位于机体右侧边缘，靠近油底壳上方
        this.addPort(this.w - 10, this.h - 40, 'in', 'pipe');
        // 冷却水出口：位于机体左侧边缘，紧贴烟管下方
        this.addPort(10, 70, 'out', 'pipe');
    }

    initVisuals() {
        const cylinderCount = 4;
        const startX = 45;
        const spacing = 45;

        // 1. 机体主色调 (底座)
        const casing = new Konva.Rect({
            x: 10, y: 30, width: 220, height: 140,
            fill: '#95a5a6', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 3
        });
        this.group.add(casing);

        // 2. 烟管与增压器
        this.exhaustManifold = new Konva.Rect({
            x: 10, y: 30, width: 180, height: 18,
            fill: '#2c3e50', stroke: '#000', cornerRadius: 2
        });

        // 增压器移至边缘对齐
        this.turbo = new Konva.Group({ x: 210, y: 40 });
        this.turbo.add(
            new Konva.Arc({ innerRadius: 6, outerRadius: 20, angle: 300, fill: '#7f8c8d', stroke: '#2c3e50', rotation: -150 }),
            new Konva.Circle({ radius: 8, fill: '#34495e', stroke: '#2c3e50' })
        );
        this.group.add(this.exhaustManifold, this.turbo);

        // 3. 循环生成分隔的气缸和分段曲轴
        for (let i = 0; i < cylinderCount; i++) {
            const x = startX + i * spacing;

            // 分隔的气缸室
            const cylinderBox = new Konva.Rect({
                x: x - 21, y: 50, width: 42, height: 70,
                stroke: '#34495e', strokeWidth: 1, fill: 'rgba(255,255,255,0.05)'
            });

            // 蓝色活塞
            const p = new Konva.Rect({
                x: x - 18, y: 60, width: 36, height: 18,
                fill: '#b06f7a', stroke: '#1a5276', strokeWidth: 1.5, cornerRadius: 2
            });

            // 粗连杆 (矩形加厚)
            const r = new Konva.Rect({
                x: x - 6, y: 78, width: 12, height: 60,
                fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 1
            });

            // 分段主轴颈 (分段显示)
            const shaftLeft = new Konva.Rect({ x: x - 22, y: 140, width: 14, height: 12, fill: '#1e6ab6' });
            const shaftRight = new Konva.Rect({ x: x + 10, y: 140, width: 14, height: 12, fill: '#1c65ae' });

            // 蓝色曲拐臂
            const web = new Konva.Rect({
                x: x - 10, y: 135, width: 20, height: 25,
                fill: '#2980b9', stroke: '#1a5276', strokeWidth: 1, cornerRadius: 3
            });

            // --- 新增：火焰效果节点 ---
            // 使用 Path 绘制一个简单的火苗形状，放置在气缸顶部
            const flame = new Konva.Path({
                x: x - 15,
                y: 50, // 固定在气缸顶部
                data: 'M15 0 L30 30 Q15 45 0 30 Z', // 简单的火苗路径
                fillRadialGradientStartPoint: { x: 15, y: 30 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 15, y: 30 },
                fillRadialGradientEndRadius: 30,
                fillRadialGradientColorStops: [0, '#ffff00', 0.5, '#ff6600', 1, 'rgba(255,0,0,0)'],
                opacity: 0,
                visible: false,
                scaleY: 0
            });
            this.flames.push(flame);
            this.pistons.push(p);
            this.rods.push(r);
            this.crankWebs.push(web);
            this.group.add(cylinderBox, shaftLeft, shaftRight, web, r, p, flame);
        }

        // 4. 油底壳
        const oilPan = new Konva.Rect({
            x: 10, y: 165, width: 220, height: 10,
            fill: '#34495e', stroke: '#2c3e50', cornerRadius: [0, 0, 3, 3]
        });
        this.group.add(oilPan);
    }

    initControlSwitch() {
        // 紧贴左上角布局
        this.switchGroup = new Konva.Group({ x: 42, y: 10 });
        const dial = new Konva.Circle({ radius: 18, fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 2 });
        this.knob = new Konva.Group({ rotation: -45 });
        this.knob.add(
            new Konva.Rect({ x: -2.5, y: -16, width: 5, height: 18, fill: '#2c3e50', cornerRadius: 1 }),
            new Konva.Rect({ x: -1, y: -14, width: 2, height: 5, fill: '#ecf0f1' })
        );

        const toggle = () => { this.sys.state.engOn = !this.sys.state.engOn; };
        dial.on('click', toggle);
        this.knob.on('click', toggle);

        this.switchGroup.add(
            dial,
            new Konva.Text({ x: -30, y: -15, text: 'OFF', fontSize: 10, fill: '#c0392b', fontStyle: 'bold' }),
            new Konva.Text({ x: 10, y: -15, text: 'ON', fontSize: 10, fill: '#27ae60', fontStyle: 'bold' }),
            this.knob
        );
        this.group.add(this.switchGroup);
    }
    initFuelKnob() {
        // 旋钮位置设定在柴油机顶部中间靠右
        const knobGroup = new Konva.Group({ x: 160, y: 15 });

        // 1. 刻度盘背景
        const dial = new Konva.Arc({
            innerRadius: 16,
            outerRadius: 22,
            angle: 180,
            fill: '#0d9a5a',
            stroke: '#2c3e50',
            strokeWidth: 1,
            rotation: 180
        });

        // 2. 指针
        this.fuelPointer = new Konva.Line({
            points: [0, 0, 0, -18],
            stroke: '#e74c3c',
            strokeWidth: 3,
            lineCap: 'round',
            rotation: 30 // 对应 0.7 的初始负荷
        });

        // 3. 装饰性刻度文字
        const label = new Konva.Text({
            x: -26, y: 5,
            text: 'FUEL / LOAD',
            fontSize: 9,
            fill: '#2c3e50',
            fontStyle: 'bold'
        });

        // 4. 透明交互层（左半圆减小，右半圆增大）
        const leftHit = new Konva.Rect({ x: -25, y: -25, width: 25, height: 30, fill: 'transparent' });
        const rightHit = new Konva.Rect({ x: 0, y: -25, width: 25, height: 30, fill: 'transparent' });

        // 5. 柴油机铭牌
        const labelText = new Konva.Text({ x: -85, y: -16, text: '柴油机', fontSize: 18, fontStyle: 'bold' });

        // 绑定点击事件
        leftHit.on('click', () => this.adjustFuel(-0.1));
        rightHit.on('click', () => this.adjustFuel(0.1));

        knobGroup.add(dial, label, this.fuelPointer, leftHit, rightHit, labelText);
        this.group.add(knobGroup);
    }

    adjustFuel(delta) {
        // 更新本地负荷值
        this.fuelRate = Math.max(0.1, Math.min(1.0, this.fuelRate + delta));
        // 同步到系统全局状态
        this.sys.state.load = this.fuelRate;

        // 更新指针角度 (-90度到90度对应 0.1到1.0)
        const targetAngle = -90 + (this.fuelRate - 0.1) * 200;
        this.fuelPointer.rotation(targetAngle);

        this.sys.layer.draw();
    }
    update(temp, isOn) {
        const targetAngle = -90 + (this.fuelRate - 0.1) * 200;
        this.fuelPointer.rotation(targetAngle);
        if (isOn) {
            // --- 动态运动逻辑 ---
            // 运动速度随负荷（喷油量）微调，负荷越大转速感越强
            const speedBase = 0.01;
            const speed = speedBase + (this.sys.state.load * 0.003);
            const time = Date.now() * speed;
            const stroke = 15;

            this.knob.rotation(this.knob.rotation() + (45 - this.knob.rotation()) * 0.5);

            this.pistons.forEach((p, i) => {
                const phase = (i === 0 || i === 3) ? 0 : Math.PI;
                const angle = (time + phase) % (Math.PI * 2);
                const dy = Math.sin(angle) * stroke;

                p.y(70 + dy);
                this.rods[i].y(88 + dy);
                this.crankWebs[i].y(135 + dy);

                // 模拟曲轴宽度微变
                const scale = Math.abs(Math.cos(angle));
                const targetW = 20 * (0.8 + scale * 0.2);
                this.crankWebs[i].width(targetW);
                this.crankWebs[i].x((45 + i * 45) - targetW / 2);

                // --- 火焰逻辑：仅在下行做功阶段显示 ---
                // 逻辑：angle 在 0 到 PI 之间是下行阶段
                const flame = this.flames[i];
                if (angle > 0 && angle < Math.PI) {
                    flame.visible(true);
                    // 随着下行深度改变火焰大小和透明度
                    const intensity = Math.sin(angle) * this.sys.state.load;
                    flame.scaleY(intensity * 1.5); // 负荷越大，火喷得越猛
                    flame.opacity(intensity);
                    // 抖动效果
                    flame.scaleX(0.8 + Math.random() * 0.4);
                } else {
                    flame.visible(false);
                    flame.opacity(0);
                }
            });
        } else {
            this.knob.rotation(this.knob.rotation() + (-45 - this.knob.rotation()) * 0.5);
            this.pistons.forEach((p, i) => {
                p.y(70);
                this.rods[i].y(88);
                this.crankWebs[i].y(135);
                this.crankWebs[i].width(20);
                this.crankWebs[i].x((45 + i * 45) - 10);
            });
            this.flames.forEach(f => {
                f.visible(false);
                f.opacity(0);
            });
        }

        // 烟管热力反馈
        if (this.exhaustManifold) {
            const heat = Math.min(255, 44 + (temp - 20) * 1.5);
            this.exhaustManifold.fill(`rgb(${Math.floor(heat)}, 46, 80)`);
        }
    }
}