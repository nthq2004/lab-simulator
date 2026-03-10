import { BaseComponent } from './BaseComponent.js';

export class PressRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.scale = 1.0;
        this.w = 340 * this.scale;
        this.h = 420 * this.scale;

        this.type = 'relay';

        // 核心物理状态
        this.pressure = 0;
        this.setPoint = 50;
        this.differential = 50;
        this.isEnergized = true;

        this.lowSet = 0.002*this.setPoint;
        this.highSet = this.lowSet+0.07+0.0018*this.differential;

        this.config = {id:this.id,lowSet:this.lowSet,highSet:this.highSet};

        this.initVisuals();

        // 端口设置 (3个接线端子位于右上方)
        this.addPort(this.w + 5, 10 * this.scale, 'NO', 'wire');
        // this.addPort(this.w + 5, 60, 'nc', 'wire');
        this.addPort(this.w + 5, 110 * this.scale, 'COM', 'wire');
        this.addPort(this.w - 45 * this.scale, this.h + 5, 'i', 'pipe');

        this._startLoop();
    }

    initVisuals() {
        this.viewGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale, x: 5, y: 5 });
        this.group.add(this.viewGroup);

        const bx = 340, by = 420;

        // --- 1. 背景外壳 ---
        this.viewGroup.add(new Konva.Rect({
            width: bx, height: by - 80, fill: '#f8f9fa', stroke: '#333', strokeWidth: 2, cornerRadius: 4
        }));

        // --- 2. 左侧：给定弹簧机构 (拉动弹簧) ---
        this.setScrew = new Konva.Rect({ x: 15, y: -20, width: 40, height: 80, fill: '#0c7b08', stroke: '#333' });
        // 红色指针 (属于 setScrew，随螺钉移动)
        this.screwPointer = new Konva.Line({
            points: [55, 40, 90, 40], // 从螺钉中心指向右侧刻度
            stroke: '#ff0000', strokeWidth: 2
        });

        this.mainSpring = new Konva.Line({ x: 47, y: 60, points: this._getSpringPoints(215), stroke: '#444', strokeWidth: 4 });
        // --- 8. 设定值指示系统 ---
        this.scaleGroup = new Konva.Group({ x: 85, y: 40 }); // 位于螺钉右侧

        // 指示牌底色
        const plate = new Konva.Rect({
            width: 30, height: 40, fill: '#eee', stroke: '#ccc', strokeWidth: 1
        });
        this.scaleGroup.add(plate);

        // 生成 10 个刻度线 (0 到 0.2 MPa)
        for (let i = 0; i <= 10; i++) {
            const yPos = 40 - (i * 4); // 从下往上画
            const isLong = i % 5 === 0;

            // 刻度线
            this.scaleGroup.add(new Konva.Line({
                points: [0, yPos, isLong ? 10 : 6, yPos],
                stroke: '#333', strokeWidth: 1
            }));

            // 文字标注 (只在 0, 0.1, 0.2 标注)
            if (isLong) {
                this.scaleGroup.add(new Konva.Text({
                    x: 12, y: yPos - 5,
                    text: (i * 0.02).toFixed(1),
                    fontSize: 10, fill: '#666'
                }));
            }
        }


        // --- 设定螺钉点击交互 ---
        this.setScrew.on('mousedown touchstart', (e) => {
            // 获取点击位置相对于螺钉顶部的偏移
            const pos = this.setScrew.getRelativePointerPosition();
            const halfHeight = this.setScrew.height() / 2;

            if (pos.y < halfHeight) {
                // 点击上半部分：增加 1% (假设量程 100)
                this.setPoint = Math.min(100, this.setPoint + 2);
            } else {
                // 点击下半部分：减少 1%
                this.setPoint = Math.max(0, this.setPoint - 2);
            }

            // 立即同步更新视觉
            this.update(this.pressure, this.setPoint, this.differential);

            // 如果有系统回调，通知系统设定值改变
            if (this.sys && this.sys.onConfigChange) {
                this.sys.onConfigChange(this.config.id, { setPoint: this.setPoint });
            }
        });
        this.setScrew.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // 设置鼠标指针样式
        this.setScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.setScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));


        // --- 3. 左下：幅差调节与限位螺钉 ---
        this.diffGroup = new Konva.Group({ x: 105, y: 340 });
        this.diffScrew = new Konva.Rect({ x: -30, y: 60, width: 60, height: 40, fill: '#077d59' });
        this.diffSpring = new Konva.Line({ x: 0, y: 0, points: this._getSpringPoints(60), stroke: '#888', strokeWidth: 2 });
        this.diffTop = new Konva.Rect({ x: -30, y: 0, width: 60, height: 10, fill: '#555' });
        this.diffCover = new Konva.Rect({ x: -40, y: 0, width: 80, height: 80, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 增加：幅差指示牌 (放在螺钉下方)
        this.diffScalePlate = new Konva.Group({ x: -40, y: 100 }); // 指示牌位置
        const plateBg = new Konva.Rect({
            width: 80, height: 20, fill: '#a7a5e8', cornerRadius: 2
        });
        // 指示窗口剪裁（可选，为了美观）
        this.diffScalePlate.add(plateBg);
        // 动态数字组 (我们将根据 diff 移动这个组)
        this.diffNumbers = new Konva.Group({ y: 3 });
        this.diffScalePlate.add(this.diffNumbers);

        // 红色指示指针 (固定在螺钉中心下方的窗口中心)
        this.diffPointer = new Konva.Line({
            points: [0, 0, 0, 20],
            stroke: 'red', strokeWidth: 4,
            x: 0, y: 75 // 指向指示牌中心
        });

        this.diffGroup.add(this.diffCover, this.diffScrew, this.diffSpring, this.diffTop, this.diffScalePlate, this.diffPointer);
        this.diffScrew.on('mousedown touchstart', (e) => {
            // 获取点击位置相对于螺钉顶部的偏移
            const pos = this.diffScrew.getRelativePointerPosition();
            const halfWidth = this.diffScrew.width() / 2;

            if (pos.x > halfWidth) {
                // 点击上半部分：增加 10% (假设量程 100)
                this.differential = Math.min(100, this.differential + 2);
            } else {
                // 点击下半部分：减少 10%
                this.differential = Math.max(0, this.differential - 2);
            }

            // 立即同步更新视觉
            this.update(this.pressure, this.setPoint, this.differential);

            // 如果有系统回调，通知系统设定值改变
            if (this.sys && this.sys.onConfigChange) {
                this.sys.onConfigChange(this.config.id, { differential: this.differential });
            }
        });
        this.diffScrew.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // 设置鼠标指针样式
        this.diffScrew.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.diffScrew.on('mouseleave', () => (document.body.style.cursor = 'default'));



        // --- 4. 核心：主杠杆 (绕支点转动) ---
        // 支点固定在 (220, 280)
        this.leverGroup = new Konva.Group({ x: 220, y: 280 });
        this.leverBar = new Konva.Line({
            points: [-185, 0, 65, 0], stroke: '#8b4513', strokeWidth: 10, lineCap: 'round'
        });
        // 限位螺钉 (作用螺钉) - 位于杠杆下方
        this.limitBolt = new Konva.Rect({ x: -122.5, y: 0, width: 15, height: 45, fill: '#999', stroke: '#333' });

        // 刀型片：位于杠杆右端上方
        this.knifeBlade = new Konva.Group({ x: 0, y: 0, rotation: 0 }); // 初始化在支点位置
        // 外部 L 型刚性实体 (灰色)
        const bladePath = new Konva.Path({
            data: 'M 0 -5 L 55 -5 L 55 -105 L 15 -105 L 15 -80 L 0 -80 Z', // 刚性L型，顶部带刀型尖
            fill: '#c0c0c0', stroke: '#444', strokeWidth: 2
        });
        // 矩形镂空窗口
        const windowCutter = new Konva.Rect({
            x: 25, y: -70, // 镂空位置
            width: 20, height: 55, // 镂空大小
            fill: 'black', globalCompositeOperation: 'destination-out' // 剪裁模式
        });
        this.knifeBlade.add(bladePath, windowCutter);

        // 红色弹性片：被刀型片左右拨动
        this.elasticPlate = new Konva.Line({
            x: 40, y: 0, points: [0, -107, 0, -197], stroke: '#979dc7', strokeWidth: 4, lineCap: 'round'
        });

        this.leverGroup.add(this.leverBar, this.limitBolt, this.knifeBlade, this.elasticPlate);
        const pivotBase = new Konva.Path({ x: 220, y: 280, data: 'M -10 15 L 10 15 L 0 0 Z', fill: '#333' });

        // --- 5. 右下：输入波纹管 ---
        this.bellows = new Konva.Group({ x: 290, y: 340 });
        // 波纹管外罩 (固定)
        this.bellowsCover = new Konva.Rect({ x: -34, y: 0, width: 70, height: 78, stroke: '#444', strokeWidth: 2, fill: '#eee' });

        // 金属传动杆 (连接杠杆和波纹管底部)
        this.connectingRod = new Konva.Line({ stroke: '#333', strokeWidth: 4, lineCap: 'round' });
        this.bellowsBody = new Konva.Path({
            data: 'M -25 0 L 25 0 L 20 5 L 25 10 L 20 15 L 25 20 L 20 25 L 25 30 L -25 30 L -20 25 L -25 20 L -20 15 L -25 10 L -20 5 Z',
            fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5, scaleY: 1.5
        });
        this.bellows.add(this.bellowsCover, this.bellowsBody);



        // --- 6. 右上：触点系统与输出端口 ---
        this.switchBox = new Konva.Group({ x: 260, y: 0 });
        // 静触点
        this.contactNC = new Konva.Circle({ x: -30, y: 55, radius: 6, fill: '#7d7c78', stroke: '#333' });
        this.contactNO = new Konva.Circle({ x: 30, y: 55, radius: 6, fill: '#777', stroke: '#333' });
        // 动触点 (挂在弹性片末端)
        this.movingContact = new Konva.Circle({ x: 0, y: 55, radius: 5.5, fill: '#858382', stroke: '#000' });
        this.movingRod = new Konva.Line({ x: 0, y: 0, points: [0, 105, 25, 55], stroke: '#555', strokeWidth: 4 });
        // 三根输出连线 (COM, NC, NO)

        this.wireCOM = new Konva.Line({ x: 0, y: 105, points: [0, 0, 80, 0], stroke: '#555', strokeWidth: 4 });
        this.wireCOMBase = new Konva.Rect({ x: -5, y: 100, width: 10, height: 10, stroke: '#444', strokeWidth: 2, fill: '#141212' });
        this.wireNO = new Konva.Line({ x: 35, y: 55, points: [0, 0, 50, 0], stroke: '#8b8a89', strokeWidth: 4 });
        this.wireNC = new Konva.Line({ x: -29, y: 5, points: [0, 0, 104, 0], stroke: '#848985', strokeWidth: 4 });
        this.wireNCUp = new Konva.Line({ x: -29, y: 50, points: [0, 0, 0, -47], stroke: '#848985', strokeWidth: 4 });

        // 增加：弯曲簧片 (弓形弹簧)
        this.toggleSpring = new Konva.Path({
            stroke: '#4c08f8',
            strokeWidth: 4,
            lineCap: 'round'
        });

        this.switchBox.add(this.contactNC, this.contactNO, this.wireCOM, this.movingContact, this.movingRod, this.wireCOMBase, this.wireNC, this.wireNCUp, this.wireNO, this.toggleSpring);

        const NOPort = new Konva.Circle({ x: 340, y: 55, radius: 6, fill: '#dee2e7', stroke: '#b3b6b9', strokeWidth: 1, });
        this.title = new Konva.Text({
            x: 100,
            y: 100,
            text: '型号：YT1226\n调节范围：0~0.2MPa\n切换差：0.07~0.25MPa', // 使用 \n 换行
            fontSize: 15,
            fontFamily: 'Calibri',
            fill: '#0930f2',
            width: 200,        // 设置宽度以便查看对齐效果
            align: 'left',    // 居中对齐：'left', 'center', 'right'
            lineHeight: 1.2     // 行间距，1.2 表示 1.2 倍字号高度
        });

        this.viewGroup.add(
            this.setScrew, this.screwPointer, this.scaleGroup, this.mainSpring, pivotBase, 
            this.diffGroup, this.leverGroup,this.bellows, this.switchBox, this.connectingRod, NOPort, this.title
        );
    }

    _getSpringPoints(h) {
        const pts = [];
        const coils = 12;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -15 : 15, (i / coils) * h);
        }
        return pts;
    }

    update(p, sp, diff) {
        if (p !== undefined)this.pressure = p;
        if (sp !== undefined) this.setPoint = Math.min(100,Math.max(sp,0));
        if (diff !== undefined) this.differential = Math.min(100,Math.max(diff,0));

        // 双位滞后逻辑
        this.lowSet = 0.2*this.setPoint/100;
        this.highSet = 0.07+0.0018*this.differential+this.lowSet;
        this.config.lowSet = this.lowSet.toFixed(3);
        this.config.highSet = this.highSet.toFixed(3);
        if (this.pressure < this.lowSet) {
            this.isEnergized = true;
        } else if (this.pressure > this.highSet) {
            this.isEnergized = false;
        }

        // 1. 杠杆受力平衡微位移 (绕支点 220, 280 旋转)
        const forceEffect = (this.pressure - this.lowSet) * 20;
        const targetRot = Math.max(-15, Math.min(15, forceEffect));
        this.leverGroup.rotation(-targetRot);

        // 2. 波纹管压缩
        const safeP = Math.max(0, Math.min(1, this.pressure));

        // 计算缩放比例：0->2, 1->1.2
        const bScaleY = 2 - (safeP * 0.8);
        this.bellowsBody.scaleY(bScaleY);


        // 3. 机械传动链动画
        // --- a. 红色弹性片顶点坐标计算 (相对于 switchBox 坐标系) ---
        const drift = -targetRot * 3.5;
        // 弹性片在 leverGroup 中坐标 x:40, 顶点 y:-197
        // switchBox 在 viewGroup 坐标 (260, 0), leverGroup 在 (220, 280)
        const epTopX = (40 + drift) + (220 - 260);
        const epTopY = -197 + 280 + 5;

        // --- b. 动触点连杆 (movingRod) 运动与 3/4 点计算 ---
        const contactX = this.isEnergized ? -20 : 20;
        this.movingContact.x(contactX);

        // 连杆起点 (0, 105), 终点 (contactX, 55)
        this.movingRod.points([0, 105, contactX, 55]);

        // 计算连杆 3/4 处的点 (靠近终点端)
        // 插值公式: P = Start + (End - Start) * 0.75
        const rodPointX = 0 + (contactX - 0) * 0.75;
        const rodPointY = 105 + (55 - 105) * 0.75; // 结果为 67.5

        // --- c. 绘制弯曲簧片 (Toggle Spring) ---
        const midX = (epTopX + rodPointX) / 2;
        const midY = (epTopY + rodPointY) / 2;

        // 弯曲方向随切换状态改变，模拟物理形变
        const bendAmount = this.isEnergized ? 30 : -30;

        this.toggleSpring.data(
            `M ${epTopX} ${epTopY} Q ${midX + bendAmount} ${midY} ${rodPointX} ${rodPointY}`
        );

        // 4. 更新传动杆线段杠杆右端点在 leverGroup 坐标系中是 (70, 0)
        // 映射到 viewGroup 坐标系：
        // 起点 (x1, y1)：波纹管底部中心
        const bellowsX = 290;
        const bellowsBottomY = 340 + (30 * bScaleY);
        const rad = (targetRot * Math.PI) / 180;
        const leverEndX = 220 + 70 * Math.cos(rad);
        const leverEndY = 280 - 70 * Math.sin(rad);
        this.connectingRod.points([bellowsX, bellowsBottomY, leverEndX, leverEndY]);



        // 5. 颜色反馈
        if (this.isEnergized) {
            this.contactNO.fill('#a8a4a4'); // 绿色接通，低压启动。
            this.wireNO.stroke('#a8a4a4');
            this.movingContact.fill('#08f818');
            this.contactNC.fill('#08f818');
            this.movingRod.stroke('#08f818');
            this.wireCOM.stroke('#08f818');
            this.wireNC.stroke('#08f818');
            this.wireNCUp.stroke('#08f818');
        } else {
            this.contactNO.fill('#f40a0a');
            this.movingContact.fill('#f40a0a');
            this.contactNC.fill('#7e807e'); // 红色接通，高压停止
            this.movingRod.stroke('#f40a0a');
            this.wireCOM.stroke('#f40a0a');
            this.wireNC.stroke('#a8a4a4');
            this.wireNCUp.stroke('#a8a4a4');
            this.wireNO.stroke('#f40a0a');
        }

        // 6. 螺钉与弹簧随动 更新设定弹簧 (核心逻辑)
        // 螺钉下端坐标
        const screwBottomY = -20 + 80 - (this.setPoint - 50) * 0.4;
        this.setScrew.y(-20 - (this.setPoint - 50) * 0.4);
        this.screwPointer.y(screwBottomY - 40);

        // 杠杆左端点坐标 (相对于支点 220, 280 的位置是 -185, 0)
        // const leverLeftX = 220 - 185 * Math.cos(rad);
        const leverLeftY = 280 + 185 * Math.sin(rad);

        // 重新绘制弹簧线段
        const springLen = leverLeftY - screwBottomY;
        this.mainSpring.x(47); // 保持 X 轴位置
        this.mainSpring.y(screwBottomY);
        this.mainSpring.points(this._getSpringPoints(springLen));

        //7.幅差机构动态逻辑 (重点) ---

        // A. 设定导致的位移：增加时向上移动 (Y减小)
        // 假设设定值为0时在最下面，设定值为100时向上移动40像素
        const diffBaseY = this.differential * 0.2;
        this.diffScrew.y(60 - diffBaseY); // 螺钉随设定移动
        this.diffTop.y(- diffBaseY);
        this.diffSpring.y(- diffBaseY);

        // B. 计算限位螺钉(limitBolt)底部的全局 Y 坐标
        // limitBolt 在 leverGroup 中的 x 是 -122.5, height 是 40
        const boltRelX = -122.5 + 7.5; // 中心点
        const boltRelY = 45;
        const boltGlobalY = 280 + boltRelX * Math.sin(-rad) + boltRelY * Math.cos(rad);

        // C. 碰撞检测与弹簧压缩
        // diffTop 在 diffGroup 内部的原始 Y 是 0
        const topStaticY = -diffBaseY + 340;
        let topCurrentY = 0; // 相对于 diffGroup
        let currentSpringH = 60; // 默认弹簧高

        if (boltGlobalY > topStaticY) {
            // 如果杠杆限位螺钉压到了顶部
            topCurrentY = boltGlobalY - topStaticY;
            currentSpringH = 60 - topCurrentY; // 弹簧被压缩
            this.diffTop.y(- diffBaseY + topCurrentY);
            this.diffSpring.y(- diffBaseY + topCurrentY);
            this.diffSpring.points(this._getSpringPoints(currentSpringH));
        }
        // --- 幅差刻度动态生成 ---
        // 修改 update 方法中的幅差数字逻辑
        const currentVal = this.differential / 10; // 可能是 5.5
        const spacing = 40; // 两个数字间的像素距离

        this.diffNumbers.destroyChildren();

        for (let i = 0; i <= 10; i++) {
            // 计算每个数字相对于中心指针的偏移
            const xOffset = (i - currentVal) * spacing;

            // 只渲染在窗口可见范围内的数字
            if (Math.abs(xOffset) < 60) {
                this.diffNumbers.add(new Konva.Text({
                    x: 40 + xOffset - 5, // 40 是窗口中心
                    y: 0,
                    text: i.toString(),
                    fontSize: 14,
                    fill: Math.abs(xOffset) < 5 ? 'red' : '#fff', // 接近中心时变红
                    fontStyle: Math.abs(xOffset) < 5 ? 'bold' : 'normal'
                }));
            }
        }

    }
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '压力下限', key: 'lowSet', type: 'number' },
            { label: '压力上限', key: 'highSet', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
    }
    _startLoop() { 
        this.update(0);
    }
}