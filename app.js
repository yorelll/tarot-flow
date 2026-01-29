/**
 * 塔罗牌占卜应用 - Tarot Flow
 * 主应用程序逻辑
 */

// 配置常量
const CONFIG = {
    GESTURE_HOLD_THRESHOLD_MS: 500,    // 手势确认需要的毫秒数
    HAND_MOVE_THRESHOLD: 0.1,          // 手部移动检测阈值（归一化坐标差值）
    MOVE_COOLDOWN_MS: 300,             // 移动操作冷却时间（毫秒）
    MAX_SELECTIONS: 3                   // 最多可选择的卡牌数量
};

class TarotFlow {
    constructor() {
        // DOM 元素
        this.cardDeck = document.getElementById('card-deck');
        this.selectedCards = document.getElementById('selected-cards');
        this.gestureStatus = document.getElementById('gesture-status');
        this.selectionIndicator = document.getElementById('selection-indicator');
        this.meaningModal = document.getElementById('meaning-modal');
        this.webcam = document.getElementById('webcam');
        this.gestureCanvas = document.getElementById('gesture-canvas');
        this.cameraBtn = document.getElementById('camera-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.closeMeaningBtn = document.getElementById('close-meaning');

        // 状态
        this.cards = [];
        this.currentIndex = Math.floor(TAROT_CARDS.length / 2);
        this.selectedCardsList = [];
        this.maxSelections = CONFIG.MAX_SELECTIONS;
        this.cameraActive = false;
        this.hands = null;
        this.camera = null;
        this.canvasCtx = null;
        
        // 手势状态
        this.lastGesture = null;
        this.gestureHoldTime = 0;
        this.gestureThreshold = CONFIG.GESTURE_HOLD_THRESHOLD_MS;
        this.lastHandPosition = null;
        this.handMoveThreshold = CONFIG.HAND_MOVE_THRESHOLD;
        this.lastMoveTime = 0;
        this.moveCooldown = CONFIG.MOVE_COOLDOWN_MS;
        this.isViewingMeaning = false; // 防止移动手势干扰查看牌义
        
        // 初始化
        this.init();
    }

    init() {
        this.initCards();
        this.initEventListeners();
        this.updateSelectionIndicator();
    }

    // 初始化卡牌
    initCards() {
        this.cardDeck.innerHTML = '';
        
        // 随机打乱卡牌顺序
        const shuffledCards = [...TAROT_CARDS].sort(() => Math.random() - 0.5);
        
        shuffledCards.forEach((cardData, index) => {
            const cardElement = this.createCardElement(cardData, index);
            this.cards.push({
                element: cardElement,
                data: cardData,
                isSelected: false
            });
            this.cardDeck.appendChild(cardElement);
        });

        // 设置初始选中卡牌
        this.highlightCard(this.currentIndex);
    }

    // 创建卡牌元素
    createCardElement(cardData, index) {
        const card = document.createElement('div');
        card.className = 'tarot-card';
        card.dataset.index = index;
        card.dataset.cardId = cardData.id;
        
        card.innerHTML = `
            <div class="card-inner">
                <div class="card-face card-back">
                    <div class="card-back-pattern"></div>
                </div>
                <div class="card-face card-front">
                    <div class="card-image" style="background: linear-gradient(135deg, ${this.getCardColor(cardData.id)} 0%, #1a0f2e 100%);"></div>
                    <div class="card-name">${cardData.name}<br><small>${cardData.nameEn}</small></div>
                </div>
            </div>
        `;

        // 点击事件（备用，非手势选择）
        card.addEventListener('click', () => {
            if (!this.cameraActive) {
                const idx = parseInt(card.dataset.index);
                this.currentIndex = idx;
                this.highlightCard(idx);
            }
        });

        return card;
    }

    // 根据卡牌 ID 获取颜色
    getCardColor(id) {
        const colors = [
            '#9b59b6', '#3498db', '#1abc9c', '#e74c3c', '#f39c12',
            '#8e44ad', '#2980b9', '#16a085', '#c0392b', '#d35400',
            '#9b59b6', '#3498db', '#1abc9c', '#e74c3c', '#f39c12',
            '#8e44ad', '#2980b9', '#16a085', '#c0392b', '#d35400',
            '#9b59b6', '#3498db'
        ];
        return colors[id % colors.length];
    }

    // 初始化事件监听
    initEventListeners() {
        // 摄像头按钮
        this.cameraBtn.addEventListener('click', () => this.toggleCamera());

        // 重置按钮
        this.resetBtn.addEventListener('click', () => this.resetGame());

        // 关闭牌义弹窗
        this.closeMeaningBtn.addEventListener('click', () => this.closeMeaning());
        this.meaningModal.addEventListener('click', (e) => {
            if (e.target === this.meaningModal) {
                this.closeMeaning();
            }
        });

        // 键盘控制（备用）
        document.addEventListener('keydown', (e) => {
            if (this.selectedCardsList.length >= this.maxSelections) return;
            
            switch(e.key) {
                case 'ArrowLeft':
                    this.moveSelection(-1);
                    break;
                case 'ArrowRight':
                    this.moveSelection(1);
                    break;
                case 'Enter':
                case ' ':
                    this.confirmSelection();
                    break;
            }
        });
    }

    // 切换摄像头
    async toggleCamera() {
        if (this.cameraActive) {
            this.stopCamera();
        } else {
            await this.startCamera();
        }
    }

    // 启动摄像头
    async startCamera() {
        try {
            this.updateStatus('📷', '正在启动摄像头...');
            
            // 检查浏览器是否支持 getUserMedia
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                this.updateStatus('❌', '您的浏览器不支持摄像头功能');
                return;
            }
            
            // 检查 MediaPipe 库是否已加载
            if (typeof Hands === 'undefined') {
                this.updateStatus('❌', '手势识别库加载失败，请刷新页面');
                console.error('MediaPipe Hands library not loaded');
                return;
            }
            
            if (typeof Camera === 'undefined') {
                this.updateStatus('❌', '摄像头工具库加载失败，请刷新页面');
                console.error('MediaPipe Camera Utils library not loaded');
                return;
            }
            
            // 初始化 MediaPipe Hands
            this.hands = new Hands({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
                }
            });

            this.hands.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.7,
                minTrackingConfidence: 0.5
            });

            this.hands.onResults((results) => this.onHandResults(results));

            // 设置 Canvas
            this.canvasCtx = this.gestureCanvas.getContext('2d');
            this.gestureCanvas.width = 320;
            this.gestureCanvas.height = 240;

            // 启动摄像头
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: 320, 
                    height: 240,
                    facingMode: 'user'
                }
            });
            
            this.webcam.srcObject = stream;
            await this.webcam.play();

            // 使用 Camera 工具进行帧处理
            this.camera = new Camera(this.webcam, {
                onFrame: async () => {
                    if (this.hands) {
                        await this.hands.send({ image: this.webcam });
                    }
                },
                width: 320,
                height: 240
            });
            
            await this.camera.start();

            this.cameraActive = true;
            this.cameraBtn.classList.add('active');
            this.cameraBtn.innerHTML = '<span>📷</span> 关闭摄像头';
            this.updateStatus('✋', '摄像头已启动，请将手放入画面');

        } catch (error) {
            console.error('摄像头启动失败:', error);
            
            // 提供更详细的错误信息
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                this.updateStatus('❌', '请允许访问摄像头权限');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                this.updateStatus('❌', '未检测到摄像头设备');
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                this.updateStatus('❌', '摄像头被其他应用占用');
            } else {
                this.updateStatus('❌', '摄像头启动失败，请检查权限');
            }
        }
    }

    // 停止摄像头
    stopCamera() {
        if (this.camera && typeof this.camera.stop === 'function') {
            this.camera.stop();
        }
        
        if (this.webcam.srcObject) {
            this.webcam.srcObject.getTracks().forEach(track => track.stop());
        }

        this.cameraActive = false;
        this.cameraBtn.classList.remove('active');
        this.cameraBtn.innerHTML = '<span>📷</span> 开启摄像头';
        this.updateStatus('📷', '摄像头已关闭');
        
        // 清除画布
        if (this.canvasCtx) {
            this.canvasCtx.clearRect(0, 0, this.gestureCanvas.width, this.gestureCanvas.height);
        }
    }

    // 手势识别结果处理
    onHandResults(results) {
        // 确保 canvas context 存在
        if (!this.canvasCtx) return;
        
        // 清除画布
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.gestureCanvas.width, this.gestureCanvas.height);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            
            // 绘制手部关键点（检查 MediaPipe 绘图函数是否可用）
            try {
                if (typeof drawConnectors === 'function' && typeof HAND_CONNECTIONS !== 'undefined') {
                    drawConnectors(this.canvasCtx, landmarks, HAND_CONNECTIONS, 
                        { color: '#c9a227', lineWidth: 2 });
                }
                if (typeof drawLandmarks === 'function') {
                    drawLandmarks(this.canvasCtx, landmarks, 
                        { color: '#f0d878', lineWidth: 1, radius: 3 });
                }
            } catch (e) {
                console.warn('绘制手部关键点失败:', e);
            }

            // 分析手势
            this.analyzeGesture(landmarks);
        } else {
            this.updateStatus('👋', '请将手放入画面');
            this.lastHandPosition = null;
            this.isViewingMeaning = false;
        }

        this.canvasCtx.restore();
    }

    // 分析手势
    analyzeGesture(landmarks) {
        // 获取关键点
        const wrist = landmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        const pinkyTip = landmarks[20];
        
        const indexMcp = landmarks[5];
        const middleMcp = landmarks[9];
        const ringMcp = landmarks[13];
        const pinkyMcp = landmarks[17];

        // 计算手掌中心
        const palmCenter = {
            x: (wrist.x + indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 5,
            y: (wrist.y + indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 5
        };

        // 检测手指是否伸展
        const isThumbOpen = this.distance(thumbTip, wrist) > this.distance(landmarks[2], wrist);
        const isIndexOpen = indexTip.y < indexMcp.y;
        const isMiddleOpen = middleTip.y < middleMcp.y;
        const isRingOpen = ringTip.y < ringMcp.y;
        const isPinkyOpen = pinkyTip.y < pinkyMcp.y;

        const openFingers = [isIndexOpen, isMiddleOpen, isRingOpen, isPinkyOpen].filter(Boolean).length;

        // 握拳检测（所有手指弯曲）
        const isFist = openFingers === 0 && !isThumbOpen;
        
        // 张开手掌检测（所有手指伸展）
        const isOpenPalm = openFingers >= 4 && isThumbOpen;

        // 当前时间
        const now = Date.now();

        // 手势处理
        if (isFist) {
            // 握拳确认选择
            this.isViewingMeaning = false;
            if (this.lastGesture === 'fist') {
                if (now - this.gestureHoldTime > this.gestureThreshold) {
                    this.updateStatus('✊', '确认选择！');
                    if (this.selectedCardsList.length < this.maxSelections) {
                        this.confirmSelection();
                        this.gestureHoldTime = now; // 重置，防止重复触发
                    }
                } else {
                    const progress = Math.round(((now - this.gestureHoldTime) / this.gestureThreshold) * 100);
                    this.updateStatus('✊', `握拳确认中... ${progress}%`);
                }
            } else {
                this.lastGesture = 'fist';
                this.gestureHoldTime = now;
                this.updateStatus('✊', '检测到握拳手势');
            }
        } else if (isOpenPalm) {
            // 检测是否有已选卡牌，张开手掌显示牌义
            if (this.selectedCardsList.length > 0 && this.lastGesture !== 'openPalm') {
                this.lastGesture = 'openPalm';
                this.gestureHoldTime = now;
                this.isViewingMeaning = false;
            } else if (this.lastGesture === 'openPalm' && now - this.gestureHoldTime > this.gestureThreshold) {
                if (this.selectedCardsList.length > 0 && !this.isViewingMeaning) {
                    this.updateStatus('🖐️', '显示牌义...');
                    this.showMeaning(this.selectedCardsList[this.selectedCardsList.length - 1]);
                    this.isViewingMeaning = true;
                    this.gestureHoldTime = now;
                }
            } else if (!this.isViewingMeaning) {
                this.updateStatus('🖐️', '张开手掌 - 查看牌义');
            }
            
            // 左右移动检测（只有在未查看牌义时才允许移动选择）
            if (!this.isViewingMeaning && this.lastHandPosition && now - this.lastMoveTime > this.moveCooldown) {
                const moveX = palmCenter.x - this.lastHandPosition.x;
                
                if (Math.abs(moveX) > this.handMoveThreshold) {
                    if (moveX > 0) {
                        // 手向右移动，选择左边的牌（镜像）
                        this.moveSelection(-1);
                        this.updateStatus('👈', '向左选择');
                    } else {
                        // 手向左移动，选择右边的牌（镜像）
                        this.moveSelection(1);
                        this.updateStatus('👉', '向右选择');
                    }
                    this.lastMoveTime = now;
                }
            }
        } else {
            this.lastGesture = null;
            this.isViewingMeaning = false;
            this.updateStatus('✋', '等待手势...');
        }

        // 更新手掌位置
        this.lastHandPosition = { x: palmCenter.x, y: palmCenter.y };
    }

    // 计算两点间距离
    distance(p1, p2) {
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }

    // 更新状态显示
    updateStatus(icon, text) {
        this.gestureStatus.innerHTML = `
            <span class="status-icon">${icon}</span>
            <span class="status-text">${text}</span>
        `;
    }

    // 移动选择
    moveSelection(direction) {
        if (this.selectedCardsList.length >= this.maxSelections) return;

        // 找到可用的卡牌（未被选中的）
        const availableCards = this.cards.filter(card => !card.isSelected);
        if (availableCards.length === 0) return;

        // 找到当前高亮卡牌在可用卡牌中的索引
        let currentAvailableIndex = availableCards.findIndex(
            card => card.element.classList.contains('selected-highlight')
        );

        if (currentAvailableIndex === -1) {
            currentAvailableIndex = 0;
        }

        // 计算新索引
        let newAvailableIndex = currentAvailableIndex + direction;
        if (newAvailableIndex < 0) newAvailableIndex = availableCards.length - 1;
        if (newAvailableIndex >= availableCards.length) newAvailableIndex = 0;

        // 更新高亮
        this.cards.forEach(card => card.element.classList.remove('selected-highlight'));
        availableCards[newAvailableIndex].element.classList.add('selected-highlight');

        // 滚动到可见区域
        availableCards[newAvailableIndex].element.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });

        this.updateSelectionIndicator();
    }

    // 高亮指定卡牌
    highlightCard(index) {
        this.cards.forEach((card, i) => {
            if (i === index && !card.isSelected) {
                card.element.classList.add('selected-highlight');
            } else {
                card.element.classList.remove('selected-highlight');
            }
        });
        this.updateSelectionIndicator();
    }

    // 更新选择指示器位置
    updateSelectionIndicator() {
        const highlightedCard = this.cards.find(card => 
            card.element.classList.contains('selected-highlight')
        );
        
        if (highlightedCard && this.selectedCardsList.length < this.maxSelections) {
            this.selectionIndicator.classList.add('active');
        } else {
            this.selectionIndicator.classList.remove('active');
        }
    }

    // 确认选择
    confirmSelection() {
        if (this.selectedCardsList.length >= this.maxSelections) {
            this.updateStatus('✅', '已选择3张牌');
            return;
        }

        // 找到当前高亮的卡牌
        const selectedCard = this.cards.find(card => 
            card.element.classList.contains('selected-highlight') && !card.isSelected
        );

        if (!selectedCard) {
            // 如果没有高亮的，选择第一个可用的
            const availableCard = this.cards.find(card => !card.isSelected);
            if (availableCard) {
                this.selectCard(availableCard);
            }
            return;
        }

        this.selectCard(selectedCard);
    }

    // 选择卡牌
    selectCard(card) {
        if (card.isSelected) return;

        card.isSelected = true;
        this.selectedCardsList.push(card.data);

        // 翻转卡牌动画
        card.element.classList.add('flipped');
        card.element.classList.remove('selected-highlight');
        card.element.classList.add('fist-confirm');

        setTimeout(() => {
            card.element.classList.remove('fist-confirm');
        }, 500);

        // 移动卡牌到已选区域
        setTimeout(() => {
            this.moveCardToSelected(card);
        }, 800);

        // 选择下一张可用卡牌
        setTimeout(() => {
            if (this.selectedCardsList.length < this.maxSelections) {
                const nextCard = this.cards.find(c => !c.isSelected);
                if (nextCard) {
                    nextCard.element.classList.add('selected-highlight');
                }
            }
            this.updateSelectionIndicator();
        }, 900);
    }

    // 将卡牌移动到已选区域
    moveCardToSelected(card) {
        const slotIndex = this.selectedCardsList.length;
        const positions = ['过去', '现在', '未来'];
        
        // 创建已选卡牌包装器
        const wrapper = document.createElement('div');
        wrapper.className = 'selected-card-wrapper';
        wrapper.innerHTML = `
            <div class="tarot-card flipped">
                <div class="card-inner">
                    <div class="card-face card-back">
                        <div class="card-back-pattern"></div>
                    </div>
                    <div class="card-face card-front">
                        <div class="card-image" style="background: linear-gradient(135deg, ${this.getCardColor(card.data.id)} 0%, #1a0f2e 100%);"></div>
                        <div class="card-name">${card.data.name}<br><small>${card.data.nameEn}</small></div>
                    </div>
                </div>
            </div>
            <div class="position-label">${positions[slotIndex - 1]}</div>
        `;

        // 点击查看牌义
        wrapper.addEventListener('click', () => {
            this.showMeaning(card.data);
        });

        // 替换空槽
        const slots = this.selectedCards.querySelectorAll('.empty-slot, .selected-card-wrapper');
        if (slots[slotIndex - 1]) {
            slots[slotIndex - 1].replaceWith(wrapper);
        }

        // 隐藏原始卡牌
        card.element.style.display = 'none';

        // 检查是否完成选择
        if (this.selectedCardsList.length >= this.maxSelections) {
            this.updateStatus('✨', '选择完成！点击卡牌查看牌义');
        }
    }

    // 显示牌义
    showMeaning(cardData) {
        document.getElementById('meaning-title').textContent = `${cardData.name} (${cardData.nameEn})`;
        document.getElementById('meaning-card-image').style.background = 
            `linear-gradient(135deg, ${this.getCardColor(cardData.id)} 0%, #1a0f2e 100%)`;
        
        document.getElementById('meaning-text').innerHTML = `
            <p><span class="keyword">关键词：</span>${cardData.keywords.join('、')}</p>
            <p><span class="keyword">正位：</span>${cardData.upright}</p>
            <p><span class="keyword">逆位：</span>${cardData.reversed}</p>
        `;

        this.meaningModal.classList.add('active');
    }

    // 关闭牌义弹窗
    closeMeaning() {
        this.meaningModal.classList.remove('active');
    }

    // 重置游戏
    resetGame() {
        // 停止摄像头
        if (this.cameraActive) {
            this.stopCamera();
        }

        // 重置状态
        this.selectedCardsList = [];
        this.currentIndex = Math.floor(TAROT_CARDS.length / 2);
        this.cards = [];
        this.lastGesture = null;
        this.lastHandPosition = null;

        // 重新初始化卡牌
        this.initCards();

        // 重置已选区域
        this.selectedCards.innerHTML = `
            <div class="empty-slot" data-slot="1">
                <span class="slot-number">1</span>
                <span class="slot-label">过去</span>
            </div>
            <div class="empty-slot" data-slot="2">
                <span class="slot-number">2</span>
                <span class="slot-label">现在</span>
            </div>
            <div class="empty-slot" data-slot="3">
                <span class="slot-number">3</span>
                <span class="slot-label">未来</span>
            </div>
        `;

        this.updateStatus('🔄', '游戏已重置');
    }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.tarotFlow = new TarotFlow();
});
