
export class StopValve {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 650;
        this.y = config.y || 330;
        this.id = config.id || `stV`;

        // 核心属性
        this.type = 'stopValve';
        this.isOpen = false;        // 默认关闭（截止状态）
        this.direction = config.direction || 'horizontal'; // 'horizontal' 或 'vertical'
        this.isAnimating = false;

        this.terminals = [];
        this.onTerminalClick = config.onTerminalClick || null;
        this.onStateChange = config.onStateChange || null;

        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: this.id,
            rotation: this.direction === 'vertical' ? 90 : 0
        });

        this.init();
    }

    init() {


        // 1. 绘制阀体主体 (圆形中心)
        this._drawValveBody();

        // 2. 绘制侧边连接管与端子
        this._drawConnectors();

        // 3. 绘制旋转手柄
        this._drawHandle();

        this.layer.add(this.group);


    }

    _drawValveBody() {
        // 外圆环
        const outerCircle = new Konva.Circle({
            radius: 25,
            stroke: '#333',
            strokeWidth: 2,
            fill: '#f5f5f5'
        });

        // 内圆（用于增强机械感）
        const innerCircle = new Konva.Circle({
            radius: 20,
            stroke: '#7f8c8d',
            strokeWidth: 1
        });

        this.group.add(outerCircle, innerCircle);
    }

    _drawConnectors() {
        const pipeW = 25, pipeH = 15;

        // 左连接管
        const leftPipe = new Konva.Rect({
            x: -50, y: -pipeH / 2,
            width: pipeW, height: pipeH,
            stroke: '#333', strokeWidth: 2,
            fill: '#bdc3c7'
        });

        // 右连接管
        const rightPipe = new Konva.Rect({
            x: 25, y: -pipeH / 2,
            width: pipeW, height: pipeH,
            stroke: '#333', strokeWidth: 2,
            fill: '#bdc3c7'
        });
        this.group.add(leftPipe, rightPipe);

        const terminalData = [
            { label: 'i', color: '#5e4446', x: -55 }, // 红
            { label: 'o', color: 'rgb(126, 139, 167)', x: 45 } // 黑
        ];
        // 这里的 ID 保持 pipe_i/o 命名，方便您的 reDrawConnections 算法寻找
        terminalData.forEach(data => {
            const term = new Konva.Rect({
                x: data.x,
                y: -10,
                width: 10,
                height: 20,
                fill: data.color,
                id: `${this.group.id()}_pipe_${data.label}` // 隐藏的逻辑点
            });
            term.strokeWidth(2);
            term.stroke('#333');
            term.setAttrs({
                connType: 'pipe',
                termId: term.id(),
                parentId: this.group.id()
            });

            term.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (this.onTerminalClick) this.onTerminalClick(term);
            });

            this.group.add(term);
            this.terminals.push(term);
        });


    }

    _drawHandle() {
        // 创建手柄组，以便独立旋转
        this.handleGroup = new Konva.Group({
            x: 0, y: 0,
            // 初始状态：截止状态（手柄垂直，旋转 0 度）
            rotation: 0
        });

        // 手柄的主杆（长矩形）
        const handleBar = new Konva.Rect({
            x: -4, y: -45, // 向上延伸
            width: 8, height: 45,
            fill: '#2c3e50',
            cornerRadius: 2,
            stroke: '#000',
            strokeWidth: 1,
            rotation: 0
        });

        // 手柄顶端的横杆（L型或T型装饰，根据您的图形）
        const handleTop = new Konva.Rect({
            x: -15, y: -45,
            width: 15, height: 8,
            fill: '#2c3e50',
            stroke: '#000',
            strokeWidth: 1,
            rotation: 0
        });

        const vavlePipe = new Konva.Rect({
            x: -5, y: -18,
            width: 10, height: 36,
            fill: '#e15606',
            stroke: '#000',
            strokeWidth: 2,
            rotation: 0
        });

        this.handleGroup.add(handleBar, handleTop, vavlePipe);
        // 绑定点击事件：点击整个组或手柄均可触发切换
        this.handleGroup.on('click tap', () => this.toggle());

        // 鼠标样式
        this.handleGroup.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.handleGroup.on('mouseleave', () => (document.body.style.cursor = 'default'));
        this.group.add(this.handleGroup);
    }

    /**
     * 切换开关状态并执行动画
     */
    toggle() {
        if (this.isAnimating) return;
        this.isOpen = !this.isOpen;
        // 状态切换后，触发外部可能需要的更新逻辑
        if (this.onStateChange) this.onStateChange(this.group.id(), { 'isOpen': this.isOpen });
        // 目标角度：关闭(截止)为0度，开启(水平流向)为90度
        this.update();
    }

    setValue(isOpen) {
        if (this.isAnimating) return;
        if (this.isOpen === isOpen) return;
        this.isOpen = isOpen;
        if (this.onStateChange) this.onStateChange(this.group.id(), { 'isOpen': this.isOpen });        
        this.update();
    }

    update() {
        this.isAnimating = true;
        // 根据当前状态调整手柄位置（如果需要在外部调用时强制更新）
        const targetRotation = this.isOpen ? 90 : 0;
        new Konva.Tween({
            node: this.handleGroup,
            duration: 0.4,
            rotation: targetRotation,
            easing: Konva.Easings.BackEaseOut,
            onFinish: () => {
                this.isAnimating = false;
            }
        }).play();
    }

    /**
     * 外部获取当前状态
     */
    getValue() {
        return this.isOpen;
    }
}