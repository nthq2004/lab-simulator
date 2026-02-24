import { ControlSystem } from './consys.js';

window.sys = new ControlSystem();

//简单的连线撤销、恢复功能
const btnUndo = document.getElementById('btnUndo');
const btnRedo = document.getElementById('btnRedo');
if (btnUndo) {
    btnUndo.onclick = () => {
        sys.history.undo();
    };
}
if (btnRedo) {
    btnRedo.onclick = () => {
        sys.history.redo();
    };
}

// 绑定“自动接线”按钮，按下后，接线、开启电源、PID默认手动模式
const btnAutoWire = document.getElementById('btnAutoWire');
if (btnAutoWire) {
    btnAutoWire.onclick = () => {
        sys.applyAllPresets();
    };
}

// 绑定“起动系统”按钮，按下后起动水泵、柴油机
const btnStartSys = document.getElementById('btnStartSys');
if (btnStartSys) {
    btnStartSys.onclick = () => {
        sys.applyStartSystem();
    };
}

//可设置PT100两个、变送器3个、PID2个、执行器2个共9个故障。
const faultBtn = document.getElementById('faultBtn');
const faultModal = document.getElementById('faultModal');
const applyBtn = document.getElementById('applyBtn');
const cancelBtn = document.getElementById('cancelBtn');
const faultForm = document.getElementById('faultForm');

/**
 * 核心：检测 sys 中各组件的物理状态，同步到 UI 勾选框
 */
function syncUIWithSystem() {
    const pt = sys.comps['pt'];
    const transmitter = sys.comps['trans'];
    const valve = sys.comps['valve'];
    const pid = sys.comps['pid'];

    const checkboxes = faultForm.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        const code = parseInt(cb.value);
        let isActivated = false;

        // 根据 sys 内部组件的实际变量值判断故障是否存在
        switch (code) {
            case 1: isActivated = (pt?.isShort === true); break; // PT短路
            case 2: isActivated = (pt?.isOpen === true); break; // PT开路
            case 3: isActivated = (transmitter?.isOpened === true); break;
            case 4: isActivated = (transmitter?.zeroAdj !== 0); break;
            case 5: isActivated = (transmitter?.spanAdj !== 1.0); break;
            case 6: isActivated = (pid?.P < 0.2); break; // 简单判定           
            case 7: isActivated = (pid?.outFault === true); break;
            case 8: isActivated = (valve?.currentResistance === Infinity); break;
            case 9: isActivated = (valve?.isStuck === true); break;
        }
        cb.checked = isActivated;
    });
}

/**
 * 修复特定故障，恢复 sys 组件的默认参数
 */
function repairFault(code) {
    const pt = sys.comps['pt'];
    const transmitter = sys.comps['trans'];
    const valve = sys.comps['valve'];
    const pid = sys.comps['pid'];

    switch (code) {
        case 1: if (pt) pt.isShort = false; break;
        case 2: if (pt) pt.isOpen = false; break;
        case 3: if (transmitter) transmitter.isOpened = false; break;
        case 4: if (transmitter) transmitter.zeroAdj = 0; break;
        case 5: if (transmitter) transmitter.spanAdj = 1.0; break;
        case 6: if (pid) { pid.P = 4.0; pid.I = 0; pid.D = 0 } break; // 恢复默认PID参数        
        case 7: if (pid) pid.outFault = false; break;
        case 8: if (valve) valve.currentResistance = 250; break;
        case 9: if (valve) valve.isStuck = false; break;
    }
}

// 绑定打开按钮
faultBtn.onclick = () => {
    syncUIWithSystem();
    faultModal.style.display = 'flex';
};

// 绑定取消按钮
cancelBtn.onclick = () => {
    faultModal.style.display = 'none';
};

// 绑定应用按钮
applyBtn.onclick = () => {
    const checkboxes = faultForm.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach(cb => {
        const code = parseInt(cb.value);
        if (cb.checked) {
            // 勾选：调用 sys 注入故障
            sys.setFault(code);
        } else {
            // 未勾选：调用修复逻辑（见下方定义）
            repairFault(code);
        }
    });

    faultModal.style.display = 'none';
    sys.layer.batchDraw(); // 刷新画布
};

// 重置系统
const btnReset = document.getElementById('btnReset');
if (btnReset) {
    btnReset.onclick = () => {
        location.reload();
    };
}

window.addEventListener('DOMContentLoaded', (event) => {
    // 调用你的初始化逻辑
    initControlLogic();
});
//选择框，不管是自动演示、单步演示、演练、评估，先在这里选择项目
function initControlLogic() {
    const taskSelect = document.getElementById('taskSelect');
    const buttons = [
        document.getElementById('btnShow'),
        document.getElementById('btnStep'),
        document.getElementById('btnTrain'),
        document.getElementById('btnEval')
    ];

    // 定义一个内部函数，用于根据下拉框的值刷新按钮状态
    const refreshUI = () => {
        const isSelected = taskSelect.value !== "";

        buttons.forEach(btn => {
            if (btn) {
                btn.disabled = !isSelected;
                // 视觉反馈
                btn.style.cursor = isSelected ? 'pointer' : 'not-allowed';
                btn.style.opacity = isSelected ? '1' : '0.5';
            }
        });
    };

    // 1. 文档加载/初始化时立即执行一次逻辑
    // 如果是封装在类中，这里直接执行一次即可
    refreshUI();

    // 2. 监听后续的手动变化
    taskSelect.addEventListener('change', () => {
        refreshUI();
        sys.switchWorkflow(taskSelect.value);
    });
}

// 全自动演示，先选择要演示的项目
const btnShow = document.getElementById('btnShow');
if (btnShow) {
    btnShow.onclick = () => {
        sys.openWorkflowPanel('show');
    };
}
// 单步演示，先选择要演示的项目
const btnStep = document.getElementById('btnStep');
if (btnStep) {
    btnStep.onclick = () => {
        sys.stepByStep();
    };
}
// 练习，先选择要练习的项目
const btnTrain = document.getElementById('btnTrain');
if (btnTrain) {
    btnTrain.onclick = () => {
        sys.openWorkflowPanel('train');
    };
}
// 评估，先选择要评估的项目
const btnEval = document.getElementById('btnEval')
if (btnEval) {
    btnEval.onclick = () => {
        sys.openWorkflowPanel('eval');
    };
}
// 监听窗口大小变化，调整舞台尺寸
window.addEventListener('resize', () => {
    // //如果窗口高度小于500，隐藏最上面的信息栏，增加仿真区域高度
    // const infoBar = document.getElementById('info-bar');
    // const statusBar = document.getElementById('status-bar');
    // if (window.innerHeight < 500) {
    //     infoBar.style.display = 'none';
    //     statusBar.style.display = 'none';
    // } else {
    //     infoBar.style.display = 'flex';
    //     statusBar.style.display = 'flex';
    // }
    sys.resize();
});