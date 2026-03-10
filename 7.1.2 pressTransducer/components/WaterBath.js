import { BaseComponent } from './BaseComponent.js';

export class WaterBath extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.scale = config.scale || 1;
        this.W = 260 * this.scale; // 稍微加宽以容纳左侧面板
        this.H = 180 * this.scale;

        // 核心物理状态
        this.ambientTemp = 20;
        this.currentTemp = 20;
        this.targetTemp = 50;
        this.isHeating = false;
        this.waterLevel = 0.75;
        this.type = 'thermostat';

        this._drawChamber();       // 绘制外壳与水
        this._drawSpiralHeater();  // 绘制圆形盘管加热器
        this._drawLeftPanel();     // 绘制左侧控制面板
        this._setupThermalPort();
        this._startThermalSimulation();
    }

    /**
     * 绘制水槽主体和 3/4 水位
     */
    _drawChamber() {
        const s = this.scale;
        // 槽体
        this.group.add(new Konva.Rect({
            width: this.W, height: this.H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.W, y: this.H },
            fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#ffffff', 1, '#95a5a6'],
            stroke: '#333', strokeWidth: 2 * s, cornerRadius: 5 * s
        }));

        // 水位区域 (避开左侧面板空间)
        const waterX = 80 * s;
        const waterW = this.W - waterX - 10 * s;
        const waterHeight = (this.H - 20 * s) * this.waterLevel;

        this.waterRect = new Konva.Rect({
            x: waterX, y: this.H - waterHeight - 10 * s,
            width: waterW, height: waterHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: waterHeight },
            fillLinearGradientColorStops: [0, '#a2d9ff', 1, '#3498db'],
            cornerRadius: 2 * s,
            opacity: 0.8
        });
        this.group.add(this.waterRect);
    }

    /**
     * 绘制圆形盘管加热器 (位于水槽底部中心)
     */
    _drawSpiralHeater() {
        const s = this.scale;
        const startX = 90 * s;
        const endX = this.W - 20 * s;
        const baseY = this.H - 25 * s;

        // 创建波浪路径模拟加热丝
        let pathData = `M ${startX} ${baseY}`;
        for (let x = startX + 10 * s; x <= endX; x += 15 * s) {
            pathData += ` L ${x} ${baseY - 5 * s} L ${x + 7 * s} ${baseY + 5 * s}`;
        }

        this.heaterWire = new Konva.Path({
            data: pathData,
            stroke: '#555',
            strokeWidth: 3 * s,
            lineCap: 'round',
            lineJoin: 'round'
        });
        this.group.add(this.heaterWire);
    }

    /**
     * 绘制左侧控制面板 (集成 LCD、旋钮、开关)
     */
    _drawLeftPanel() {
        const s = this.scale;
        const panel = new Konva.Group({ x: 5 * s, y: 5 * s });

        // 面板底色
        panel.add(new Konva.Rect({
            width: 70 * s, height: this.H - 10 * s,
            fill: '#ecf0f1', stroke: '#7f8c8d', cornerRadius: 3 * s
        }));

        // 1. 液晶显示屏 (顶部)
        // ... (保持你原有的 LCD 代码不变) ...
        const lcd = new Konva.Group({ x: 5 * s, y: 10 * s });
        lcd.add(new Konva.Rect({
            width: 60 * s, height: 30 * s,
            fill: '#2c3e50', stroke: '#000', cornerRadius: 2 * s
        }));
        this.tempDisplay = new Konva.Text({
            x: 0, y: 8 * s, width: 60 * s,
            text: '20.0', fontSize: 14 * s, fontStyle: 'bold',
            fill: '#00ff00', align: 'center', fontFamily: 'monospace'
        });
        lcd.add(this.tempDisplay);
        panel.add(lcd);

        // --- 2. 调温旋钮与刻度 (中间) ---
        const knobX = 35 * s;
        const knobY = 90 * s; // 稍微下移一点点给LCD留空间

        // 绘制刻度线
        const minTemp = 20;
        const maxTemp = 100;
        const startAngle = 135; // 对应 20度 (左下方)
        const sweepAngle = 270; // 总跨度
        const radiusInner = 20 * s; // 刻度线起点
        const radiusOuter = 24 * s; // 刻度线终点
        const radiusText = 30 * s;  // 文字位置

        for (let t = minTemp; t <= maxTemp; t += 10) {
            // 计算当前温度对应的角度 (弧度)
            const angleDeg = startAngle + ((t - minTemp) / (maxTemp - minTemp)) * sweepAngle;
            const angleRad = (angleDeg * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);

            // 区分大刻度(带文字)和小刻度
            const isMajor = t % 20 === 0;
            const currentOuter = isMajor ? radiusOuter : (radiusOuter - 2 * s);

            // 绘制线条
            panel.add(new Konva.Line({
                points: [
                    knobX + radiusInner * cos, knobY + radiusInner * sin,
                    knobX + currentOuter * cos, knobY + currentOuter * sin
                ],
                stroke: '#7f8c8d',
                strokeWidth: isMajor ? 1.5 * s : 1 * s
            }));

            // 绘制文字标识 (20, 40, 60, 80, 100)
            if (isMajor) {
                panel.add(new Konva.Text({
                    x: knobX + radiusText * cos - 10 * s,
                    y: knobY + radiusText * sin - 5 * s,
                    width: 20 * s,
                    text: t.toString(),
                    fontSize: 8 * s,
                    align: 'center',
                    fill: '#34495e',
                    fontStyle: 'bold'
                }));
            }
        }

        const knobGroup = new Konva.Group({ x: knobX, y: knobY, cursor: 'pointer' });
        knobGroup.add(new Konva.Circle({ radius: 16 * s, fill: '#7f8c8d', stroke: '#2c3e50', shadowBlur: 2 }));
        const pointer = new Konva.Rect({ x: -2 * s, y: -16 * s, width: 4 * s, height: 8 * s, fill: '#e74c3c', cornerRadius: 1 });
        knobGroup.add(pointer);

        // 初始化旋钮角度
        knobGroup.rotation(((this.targetTemp - minTemp) / (maxTemp - minTemp)) * sweepAngle + startAngle);

        // 旋钮交互逻辑
        // 旋钮交互

        knobGroup.on('mousedown touchstart', (e) => {

            e.cancelBubble = true;

            const startY = e.evt.clientY || (e.evt.touches && e.evt.touches[0].clientY);

            const startTemp = this.targetTemp;

            const handleMove = (ev) => {

                const curY = ev.clientY || (ev.touches && ev.touches[0].clientY);

                this.targetTemp = Math.min(100, Math.max(20, startTemp + (startY - curY) * 0.5));

                knobGroup.rotation((this.targetTemp - 20) / 80 * 270 - 135);

                this.sys.layer?.batchDraw();

            };

            const handleUp = () => {

                window.removeEventListener('mousemove', handleMove);

                window.removeEventListener('mouseup', handleUp);

            };

            window.addEventListener('mousemove', handleMove);

            window.addEventListener('mouseup', handleUp);

        });

        panel.add(knobGroup);
        panel.add(new Konva.Text({ x: 0, y: knobY + 28 * s, width: 70 * s, text: "温度设定", fontSize: 11 * s, align: 'center', fontStyle: 'bold' }));

        // 3. 加热开关 (底部)
        const switchY = 145 * s;
        const switchGroup = new Konva.Group({ x: 35 * s, y: switchY, cursor: 'pointer' });
        switchGroup.add(new Konva.Rect({ x: -15 * s, y: -10 * s, width: 30 * s, height: 20 * s, fill: '#bdc3c7', cornerRadius: 3 * s }));
        this.switchKnob = new Konva.Circle({ x: -8 * s, radius: 7 * s, fill: '#c0392b' });
        switchGroup.add(this.switchKnob);

        switchGroup.on('click', () => {
            this.isHeating = !this.isHeating;
            new Konva.Tween({
                node: this.switchKnob, duration: 0.1,
                x: this.isHeating ? 8 * s : -8 * s,
                fill: this.isHeating ? '#27ae60' : '#c0392b'
            }).play();
        });

        panel.add(switchGroup);
        panel.add(new Konva.Text({ x: 0, y: switchY + 12 * s, width: 70 * s, text: "电源", fontSize: 11 * s, align: 'center', fontStyle: 'bold' }));

        this.group.add(panel);
    }

    _setupThermalPort() {
        const s = this.scale;
        this.thermalPort = {
            x: (this.W + 80 * s) / 2,
            y: this.H / 2,
            radius: 50 * s
        };
    }

    _startThermalSimulation() {
        this.timer = setInterval(() => {
            const dt = 0.5;
            const heatingActive = (this.isHeating && this.currentTemp < this.targetTemp);

            // 加热盘管视觉反馈
            this.heaterWire.stroke(heatingActive ? '#ff4d4d' : '#555');
            this.heaterWire.shadowBlur(heatingActive ? 5 : 0);
            this.heaterWire.shadowColor('#ff4d4d');

            const heatInput = heatingActive ? 0.8 : 0;
            const cooling = 0.006 * (this.currentTemp - this.ambientTemp);
            this.currentTemp += (heatInput - cooling) * dt;
            this.currentTemp = Math.max(this.ambientTemp, Math.min(100, this.currentTemp));

            if (this.tempDisplay) this.tempDisplay.text(this.currentTemp.toFixed(1));

            // PT100 耦合
            if (this.sys?.comps) {
                // 获取水面的绝对位置矩形
                const waterClientRect = this.waterRect.getClientRect();

                Object.values(this.sys.comps).forEach(comp => {
                    if (comp.special === 'pt100' && comp.update) {
                        // A. 尝试获取 PT100 内部的探棒图形 (在 PT100 类中定义的那个 Rect)
                        // 如果 PT100 类中没有显式暴露 probe，则取组件右半部分的估计区域
                        const probeNode = comp.probe;
                        const probeClientRect = probeNode.getClientRect();

                        // B. 矩形重叠检测 (AABB Collision)
                        const isIntersecting = !(
                            probeClientRect.x > waterClientRect.x + waterClientRect.width ||
                            probeClientRect.x + probeClientRect.width < waterClientRect.x ||
                            probeClientRect.y > waterClientRect.y + waterClientRect.height ||
                            probeClientRect.y + probeClientRect.height < waterClientRect.y
                        );

                        // C. 更新阻值
                        // 如果在水中，传递当前水温；否则传递环境温度
                        comp.update(isIntersecting ? this.currentTemp : this.ambientTemp);
                    }
                    if (comp.special === 'tc' && comp.update) {
                        // A. 尝试获取 tc 内部的探棒图形 (在 tc 类中定义的那个 Rect)
                        // 如果 tc类中没有显式暴露 probe，则取组件右半部分的估计区域
                        const probeNode = comp.probe;
                        const probeClientRect = probeNode.getClientRect();

                        // B. 矩形重叠检测 (AABB Collision)
                        const isIntersecting = !(
                            probeClientRect.x > waterClientRect.x + waterClientRect.width ||
                            probeClientRect.x + probeClientRect.width < waterClientRect.x ||
                            probeClientRect.y > waterClientRect.y + waterClientRect.height ||
                            probeClientRect.y + probeClientRect.height < waterClientRect.y
                        );

                        // C. 更新mV值
                        // 如果在水中，传递当前水温；否则传递环境温度
                        comp.update(isIntersecting ? this.currentTemp - this.ambientTemp : 0);
                    }


                });
            }
        }, 500);
    }
}