export class LeakDetector {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 730;
        this.y = config.y || 80;

        // --- 新增：可设置的宽度和高度 ---
        this.w = config.width || 40;
        this.h = config.height || 70;

        this.getTerminals = config.getTerminals;

        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: config.id || 'leD',
            name: 'leakDetector'
        });

        this.bubbles = [];
        this.isEmitting = false;
        this.anim = null;

        this.initVisuals();
        this.initInteractions();
        this.layer.add(this.group);
    }

    initVisuals() {
        // 1. 瓶身 - 使用传入的 this.w 和 this.h
        this.bottle = new Konva.Rect({
            width: this.w,
            height: this.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.w, y: 0 },
            fillLinearGradientColorStops: [0, '#a1c4fd', 0.5, '#c2e9fb', 1, '#a1c4fd'],
            stroke: '#5fa9f6',
            strokeWidth: 2,
            cornerRadius: [this.w * 0.1, this.w * 0.1, this.w * 0.2, this.w * 0.2],
            opacity: 0.8
        });

        // 2. 瓶盖 - 位置和尺寸随瓶身比例缩放
        const capW = this.w * 0.5;
        const capH = Math.min(this.h * 0.12, 10);
        this.cap = new Konva.Rect({
            x: (this.w - capW) / 2,
            y: -capH,
            width: capW,
            height: capH,
            fill: '#4a90e2',
            cornerRadius: 2
        });

        // 3. 标签 - 自动居中
        this.label = new Konva.Text({
            text: 'LEAK\nTEST',
            fontSize: Math.max(this.w * 0.2, 8),
            fontStyle: 'bold',
            fill: '#2c3e50',
            x: 0,
            y: this.h * 0.3,
            width: this.w,
            align: 'center'
        });

        // 4. 内部装饰小泡泡 (静态)
        for (let i = 0; i < 5; i++) {
            const deco = new Konva.Circle({
                x: Math.random() * (this.w * 0.8) + (this.w * 0.1),
                y: Math.random() * (this.h * 0.7) + (this.h * 0.1),
                radius: Math.random() * (this.w * 0.08) + 1,
                fill: 'white',
                opacity: 0.4
            });
            this.group.add(deco);
        }

        this.group.add(this.bottle, this.cap, this.label);
    }

    initInteractions() {
        this.group.on('dragmove', () => {
            this.checkCollision();
        });

        this.group.on('dragend', () => {
            this.stopEmitting();
        });

        // 鼠标悬停手势处理
        this.group.on('mouseenter', () => {
            if (this.stage) this.stage.container().style.cursor = 'grab';
        });

        this.group.on('mouseleave', () => {
            if (this.stage) this.stage.container().style.cursor = 'default';
        });
    }

    checkCollision() {
        const detectorPos = this.group.getAbsolutePosition();

        // --- 探测点动态更新：始终在瓶盖正上方 ---
        const probeX = detectorPos.x + this.w / 2;
        const probeY = detectorPos.y - (this.h * 0.1);

        const terminals = this.getTerminals();
        let foundLeak = false;

        if (terminals) {
            terminals.forEach(term => {
                const termPos = term.getAbsolutePosition();
                const dist = Math.sqrt(
                    Math.pow(probeX - termPos.x, 2) + Math.pow(probeY - termPos.y, 2)
                );

                // 碰撞判定半径随瓶子宽度微调
                if (dist < (this.w * 0.6) && term.getAttr('isLeaking')) {
                    foundLeak = true;
                }
            });
        }

        if (foundLeak) {
            this.startEmitting(probeX, probeY);
        } else {
            this.stopEmitting();
        }
    }

    startEmitting(x, y) {
        if (this.isEmitting) return;
        this.isEmitting = true;

        this.anim = new Konva.Animation((frame) => {
            // 生成泡泡的频率
            if (frame.timeDiff > 0 && Math.random() > 0.8) {
                this.createBubbleParticle(x, y);
            }

            for (let i = this.bubbles.length - 1; i >= 0; i--) {
                const b = this.bubbles[i];
                b.setY(b.y() - 1.2);
                b.setX(b.x() + Math.sin(frame.time / 200) * 0.8);
                b.opacity(b.opacity() - 0.015);

                if (b.opacity() <= 0) {
                    b.destroy();
                    this.bubbles.splice(i, 1);
                }
            }
        }, this.layer);

        this.anim.start();
    }

    stopEmitting() {
        this.isEmitting = false;
        if (this.anim) {
            this.anim.stop();
            this.anim = null;
        }
    }

    createBubbleParticle(x, y) {
        const bubble = new Konva.Circle({
            x: x + (Math.random() - 0.5) * (this.w * 0.3),
            y: y,
            radius: Math.random() * (this.w * 0.2) + 2,
            stroke: 'white',
            strokeWidth: 1,
            fill: 'rgba(7, 7, 233, 0.4)',
            opacity: 0.8,
            listening: false
        });
        this.layer.add(bubble);
        this.bubbles.push(bubble);
    }

    // LeakDetector 类内部
    clearAllBubbles() {
        // 停止发射动画
        this.stopEmitting();

        // 遍历并销毁所有现存的泡泡节点
        this.bubbles.forEach(b => {
            if (b) {
                b.destroy(); // 从 Konva 图层彻底移除
            }
        });

        // 清空引用数组
        this.bubbles = [];

        // 强制重绘图层以立即消除视觉残影
        this.layer.batchDraw();
    }
}