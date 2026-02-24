
export class TeeConnector {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 370;
        this.y = config.y || 350;
        this.id = config.id || `tCo`;
        this.direction = config.direction || 'up'; // 默认朝上，向上时3个接口分别为：上(u), 左(l), 右(r)，向下时3个接口分别为：下(u), 左(l), 右(r)，向左时3个接口分别为：左(u), 上(l), 下(r)，向右时3个接口分别为：右(u), 上(l), 下(r)。用于确定接口位置和旋转角度。

        this.type = 'teeConnector';
        this.terminals = [];
        this.onTerminalClick = config.onTerminalClick || null;
        // 工业标准色值
        this.colors = {
            body: '#c1bcbc',      // 浅灰色塑钢主体
            metal: '#353638',     // 不锈钢卡环
            terminal: '#8590d8'   // 逻辑端子颜色（仅供交互）
        };

        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: this.id,
            name: 'device threeWayValve' // 保持逻辑一致性
        });

        this.init();
    }

    init() {
        // 1. 绘制中心块（三个方向的交汇处）
        const centerBlock = new Konva.Rect({
            x: -20, y: -20,
            width: 40, height: 40,
            fill: this.colors.body,
            stroke: '#ccc',
            strokeWidth: 1,
            cornerRadius: 5
        });
        this.group.add(centerBlock);

        this._drawPort(0, -20, 0, 'u');    // 上接口 (Up)
        this._drawPort(-20, 0, -90, 'l');  // 左接口 (Left)
        this._drawPort(20, 0, 90, 'r');    // 右接口 (Right)

        // 2. 绘制三个快插接口，根据方向调整位置和旋转
        if (this.direction === 'up') {
        } else if (this.direction === 'down') {
            this.group.rotation(180); // 整体旋转180度，接口位置不变但方向相反
        } else if (this.direction === 'left') {
            this.group.rotation(-90); // 整体旋转-90度，接口位置不变但方向相反
        } else if (this.direction === 'right') {
            this.group.rotation(90); // 整体旋转90度，接口位置不变但方向相反
        }
        this.layer.add(this.group);
    }

    /**
     * 绘制单个快插接口
     * @param {number} x 相对位置X
     * @param {number} y 相对位置Y
     * @param {number} rotation 旋转角度
     */
    _drawPort(x, y, rotation, id) {
        const portGroup = new Konva.Group({ x, y, rotation });

        // 塑料主体延伸段
        const pipe = new Konva.Rect({
            x: -15, y: -25,
            width: 30, height: 25,
            fill: this.colors.body,
            stroke: '#ccc',
            strokeWidth: 0.5
        });

        // 金属卡环 (Stainless steel ring)
        const metalRing = new Konva.Rect({
            x: -17, y: -28,
            width: 34, height: 6,
            fill: this.colors.metal,
            stroke: '#888',
            strokeWidth: 0.5,
            cornerRadius: 1
        });

        // 气管端口
        const term = new Konva.Rect({
            x: -10, y: -36,
            width: 20, height: 10,
            fill: this.colors.terminal,
            cornerRadius: 2,
            id: `${this.group.id()}_pipe_${id}`, // 端口ID，格式为 设备ID_pipe_角色
        });
        term.strokeWidth(2);
        term.stroke('#333');
        term.setAttr('connType', 'pipe');
        term.setAttr('termId', term.id());
        term.setAttr('parentId', this.group.id());
        term.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this.onTerminalClick(term);
        });
        this.terminals.push(term);

        portGroup.add(pipe, metalRing, term);
        this.group.add(portGroup);
    }

}