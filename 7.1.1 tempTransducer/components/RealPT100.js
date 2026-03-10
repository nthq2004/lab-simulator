import { BaseComponent } from './BaseComponent.js';

export class RealPT100 extends BaseComponent {
    /**
     * @param {Object} config - 配置参数
     * @param {number} config.scale - 缩放比例 (默认 1)
     * @param {number} config.r0 - 0°C 时的基准电阻 (默认 100)
     * @param {Object} sys - 系统引用
     */
    constructor(config, sys) {
        super(config, sys);

        // ===== 参数配置 =====
        this.scale = config.scale || 1.5;
        this.r0 = config.r0 || 100; // 支持 PT1000 扩展
        this.alpha = 0.3851;        // 铂电阻温度系数
        
        // 核心状态
        this.type = 'resistor';
        this.special = 'pt100';
        this.currentResistance = this.r0;
        this.isOpen = false;
        this.isShort = false;

        // 标准基准尺寸 (用于缩放计算)
        this.baseW = 120;
        this.baseH = 80;

        // ===== 初始化绘制 =====
        this._drawSensorModel();
        this._createTailPorts();
        this._setupInteractions();
    }

    /**
     * 绘制传感器实物模型
     */
    _drawSensorModel() {
        const s = this.scale;
        
        // 1. 不锈钢探棒 (右侧前端，无端口)
        this.probe = new Konva.Rect({
            x: 40 * s, y: -5 * s, 
            width: 70 * s, height: 10 * s,
            fillLinearGradientStartPoint: { x: 0, y: -3 * s },
            fillLinearGradientEndPoint: { x: 0, y: 3 * s },
            fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#ffffff', 1, '#95a5a6'],
            cornerRadius: [0, 3 * s, 3 * s, 0]
        });

        // 2. 六角安装螺母与螺纹
        const hexNut = new Konva.Rect({
            x: 30 * s, y: -10 * s, width: 10 * s, height: 20 * s,
            fill: '#7f8c8d', stroke: '#2c3e50', strokeWidth: 1 * s, cornerRadius: 1 * s
        });

        // 3. 柔性金属屏蔽线 (尾部连接部分)
        const wirePath = new Konva.Line({
            points: [
                30 * s, 0,
                10 * s, 0,
                0, 10 * s,
                -10 * s, 30 * s,
                -30 * s, 40 * s
            ],
            stroke: '#bdc3c7',
            strokeWidth: 5 * s,
            tension: 0.5,
            shadowBlur: 2 * s,
            shadowColor: '#000'
        });

        // 4. 三线制分线头 (尾端)
        const tailY = 40 * s;
        const tailX = -30 * s;
        
        // 绘制三根彩色引线 (红、蓝、蓝)
        const colors = ['#e74c3c', '#3498db', '#3498db'];
        colors.forEach((color, i) => {
            const offset = (i - 1) * 30 * s;
            this.group.add(new Konva.Line({
                points: [tailX, tailY, tailX - 20 * s, tailY + offset],
                stroke: color,
                strokeWidth: 4 * s
            }));
            
            // 绘制末端冷压端子
            this.group.add(new Konva.Rect({
                x: tailX - 36 * s, y: tailY + offset - 5 * s,
                width: 20 * s, height: 10 * s,
                fill: '#bdc3c7', stroke: '#7f8c8d', strokeWidth: 0.5 * s
            }));
        });

        this.group.add(wirePath, hexNut, this.probe);

        // 5. 数据文本
        this.resText = new Konva.Text({
            x: -40 * s, y: -15 * s,
            text: `PT 100`,
            fontSize: 12 * s,
            fontStyle: 'bold',
            fill: '#2c3e50',
            align: 'center'
        });
        this.group.add(this.resText);
    }

    /**
     * 在尾端引出 3 个电气接口
     */
    _createTailPorts() {
        const s = this.scale;
        const tailX = -56 * s; // 接口相对于组件中心的位置
        const tailY = 40 * s;
        
        // 三线制接口：L (Line), R (Return), T (Third/Compensation)
        this.addPort(tailX, tailY - 30 * s, 'l', 'wire','p'); // 红色线
        this.addPort(tailX, tailY, 't', 'wire');       // 蓝色线1
        this.addPort(tailX, tailY + 30 * s, 'r', 'wire'); // 蓝色线2
    }

    /**
     * 更新物理电阻值
     * @param {number} temp - 输入温度
     */
    update(temp) {
        // 计算标准电阻
        let res = this.r0 + this.alpha * temp;

        // 故障逻辑
        if (this.isOpen) res = 1e8;
        if (this.isShort) res = 0.01;

        this.currentResistance = res;

        // UI 更新
        // const display = res > 10000 ? "OPEN" : res.toFixed(2) + " Ω";
        // this.resText.text(display);
        // this.resText.fill(this.isOpen || this.isShort ? '#e74c3c' : '#2c3e50');
    }

    _setupInteractions() {
        this.probe.on('dblclick', (e) => {
            e.cancelBubble = true;
            this.isOpen = false;
            this.isShort = false;
            this.update();
            this.sys.layer?.batchDraw();
        });
    }
}