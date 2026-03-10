import { BaseComponent } from './BaseComponent.js';

export class StopValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 1. 基础设置与缩放
        this.scale = config.scale || 1.2;
        this.w = 120 * this.scale;
        this.h = 100 * this.scale;

        // 2. 核心属性
        this.type = 'stopValve';
        this.isOpen = config.isOpen || false; // 默认关闭
        this.isAnimating = false;
        this.reverse = false;

        this.config = { id: this.id, isOpen: this.isOpen, reverse: this.reverse };

        // 3. 执行绘制
        this.initVisuals();

        // 4. 添加管路端口 (基于中心点偏移)
        // 输入端 (i)

        this.initPort();

        // 注意：截止阀通常不需要 _startLoop，因为它属于被动拓扑组件，
        // 它的状态改变会通过 Solver 在下一帧自动生效。
    }


    initPort() {
        if (this.reverse) {
            this.addPort(10 * this.scale, this.h / 2, 'i', 'pipe','in');
            // 输出端 (o)
            this.addPort(this.w - 10 * this.scale, this.h / 2, 'o', 'pipe');
        } else {
            this.addPort(10 * this.scale, this.h / 2, 'o', 'pipe');
            // 输出端 (o)
            this.addPort(this.w - 10 * this.scale, this.h / 2, 'i', 'pipe','in');
        }
    }
    initVisuals() {
        // 创建视觉容器，居中对齐
        this.viewGroup = new Konva.Group({
            x: this.w / 2,
            y: this.h / 2,
            scaleX: this.scale,
            scaleY: this.scale
        });
        this.group.add(this.viewGroup);

        // 1. 绘制阀体管线背景
        const pipeW = 100, pipeH = 16;
        const bodyPipe = new Konva.Rect({
            x: -pipeW / 2, y: -pipeH / 2,
            width: pipeW, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: -pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: pipeH / 2 },
            fillLinearGradientColorStops: [0, '#bbf3f7', 0.5, '#bdc3c7', 1, '#abf0f5'],
            cornerRadius: 2,
            stroke: '#87b574', strokeWidth: 1
        });

        // 2. 绘制阀门中心球体/基座
        const baseCircle = new Konva.Circle({
            radius: 22,
            fill: 'radial-gradient(at 30% 30%, #f5f5f5 0%, #74b7e3 100%)',
            stroke: '#949696',
            strokeWidth: 2
        });

        // 3. 绘制旋转手柄组
        this._drawHandle();

        this.viewGroup.add(bodyPipe, baseCircle, this.handleGroup);

        // 初始状态同步
        this.handleGroup.rotation(this.isOpen ? 90 : 0);
    }

    _drawHandle() {
        this.handleGroup = new Konva.Group({
            x: 0, y: 0,
            rotation: 0 // 0度垂直(关闭), 90度水平(开启)
        });

        // 手柄连杆
        const handleBar = new Konva.Rect({
            x: -5, y: -35,
            width: 10, height: 30,
            fill: '#2c3e50',
            stroke: '#000', strokeWidth: 1,
            cornerRadius: 4
        });

        // 手柄末端标识（球形或醒目颜色）
        const handleKnob = new Konva.Circle({
            x: 0, y: -35,
            radius: 8,
            fill: '#e74c3c', // 红色提醒
            stroke: '#c0392b', strokeWidth: 1
        });

        // 内部核心阀芯线（装饰，随手柄旋转）
        const coreIndicator = new Konva.Rect({
            x: -3, y: -15,
            width: 6, height: 30,
            fill: '#ecf0f1',
            opacity: 0.6
        });

        this.handleGroup.add(handleBar, handleKnob, coreIndicator);

        // 交互逻辑
        this.handleGroup.on('click tap', (e) => {
            e.cancelBubble = true;
            this.toggle();
        });

        this.handleGroup.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.handleGroup.on('mouseleave', () => (document.body.style.cursor = 'default'));
    }

    toggle() {
        if (this.isAnimating) return;
        this.isOpen = !this.isOpen;
        this.update();

        // 通知系统配置变更（用于保存数据或更新 Solver）
        if (this.sys && this.sys.onConfigChange) {
            this.sys.onConfigChange(this.id, { isOpen: this.isOpen });
        }
    }

    /**
     * 重写 update，主要处理动画
     */
    update() {
        const targetRotation = this.isOpen ? 90 : 0;

        // 检查节点是否已加入图层
        if (this.handleGroup.getLayer()) {
            this.isAnimating = true;

            // 如果已有运行中的 Tween，先停止它防止冲突
            if (this.currentTween) this.currentTween.destroy();

            this.currentTween = new Konva.Tween({
                node: this.handleGroup,
                duration: 0.3,
                rotation: targetRotation,
                easing: Konva.Easings.BackEaseOut,
                onFinish: () => {
                    this.isAnimating = false;
                }
            });
            this.currentTween.play();
        } else {
            // 如果还没加入图层，直接设置角度，不执行动画，避免报错
            this.handleGroup.rotation(targetRotation);
        }
    }

    // --- 系统接口 ---

    getValue() {
        return this.isOpen;
    }

    /**
     * 响应外部设置（如求解器强制关闭或脚本控制）
     */
    setValue(val) {
        if (typeof val === 'boolean' && this.isOpen !== val) {
            this.isOpen = val;
            this.update();
        }
    }

    // --- 配置面板功能 ---

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '初始状态',
                key: 'isOpen',
                type: 'select',
                options: [
                    { label: '关闭 (截断)', value: false },
                    { label: '开启 (连通)', value: true }
                ]
            },
            {
                label: '方向',
                key: 'reverse',
                type: 'select',
                options: [
                    { label: '右边入口', value: false },
                    { label: '左边入口', value: true }
                ]
            }

        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.isOpen !== undefined) {
            // 注意处理字符串转布尔值
            this.isOpen = (newConfig.isOpen === 'true' || newConfig.isOpen === true);
        }
        // if (newConfig.reverse != this.reverse) {
        //     this.reverse = newConfig.reverse;
        //     this.group.destroy();
        //     this.initVisuals();
        //     this.initPort();
        // }
        this.update();
    }
}