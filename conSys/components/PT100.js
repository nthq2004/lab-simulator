import { BaseComponent } from './BaseComponent.js';

export class PT100 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'resistor';
        this.currentResistance = 100;
        this.isOpen = false;  //
        this.isShort = false;

        // 探棒形状
        const probe = new Konva.Line({
            points: [-10, 20, 10, 20, 20, 10, 30, 30, 40, 10, 50, 30, 60, 10, 70, 20, 90, 20],
            stroke: '#2c3e50', strokeWidth: 2
        });

        const info = new Konva.Text({
            y: 35, width: 80, text: 'PT100', align: 'center', fontSize: 18
        });

        this.resText = info;
        this.group.add(probe, info);
        this.addPort(-10, 20, 'l');
        this.addPort(90, 20, 'r');

        // 双击清除探头故障（开路/短路）
        this.group.on('dblclick', () => {
            if (this.isOpen  ===true) this.isOpen = false;
            if (this.isShort  ===true) this.isShort = false;
            try { this.sys.layer.batchDraw(); } catch (e) { }
        });
    }

    update(temp) {
        this.currentResistance = 100 + 0.3851 * temp;
        if (this.isOpen === true) {
            this.currentResistance = 1000000000;
        }
        if (this.isShort ===true)
        {
            this.currentResistance = 0;
        }
    }
}