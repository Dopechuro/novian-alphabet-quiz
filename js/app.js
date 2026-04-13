import { numbersList, uppercaseList, lowercaseList, backgroundImages } from './data.js';

// MODIFICATION: Added cleanup tracking for event listeners to prevent memory leaks
let globalKeydownHandler = null;
// MODIFICATION: Track tooltip to clean up when switching away from reading screen
let currentReadingTooltip = null;

const state = {
    storyData: [],
    currentStoryIndex: 0,
    interactionMode: '',
    quizType: 'standard',
    writeQuizType: 'standard',
    selectQuizType: 'standard',
    currentPool: [],
    activeSetMode: '',
    srsLists: {},
    minList: 0,
    maxList: 1,
    currentListIdx: 0,
    currentTargets: [],
    score: 0,
    attempts: 0,
    isFocusMode: false,
    timerInterval: null,
    secondsElapsed: 0,
    isLogoFloating: false,
    currentLogosCount: 0,
    maxLogos: 5,
    logoSpawnInterval: null
};

const dom = {
    mainMenu: document.getElementById('main-menu'),
    quizTypeMenu: document.getElementById('quiz-type-menu'),
    srsSelect: document.getElementById('srs-level'),
    gameScreen: document.getElementById('game-screen'),
    readingScreen: document.getElementById('reading-screen'),
    displayElement: document.getElementById('display-char'),
    writeUI: document.getElementById('write-ui'),
    selectUI: document.getElementById('select-ui'),
    inputElement: document.getElementById('user-guess'),
    feedbackElement: document.getElementById('feedback-text'),
    lastResultElement: document.getElementById('last-result'),
    scoreElement: document.getElementById('score'),
    attemptsElement: document.getElementById('attempts'),
    remainingElement: document.getElementById('remaining-count'),
    timerElement: document.getElementById('timer-display'),
    focusIconImg: document.getElementById('focus-icon-img'),
    optionBtns: document.querySelectorAll('.option-btn'),
    upperLowerLabel: document.getElementById('learn-upper-lower'),
    helpModal: document.getElementById('help-modal'),
    btnReading: document.getElementById('btn-reading-practice'),
    readingImage: document.getElementById('reading-image'),
    readingTitle: document.getElementById('reading-title'),
    readingText: document.getElementById('reading-text'),
    readingError: document.getElementById('reading-error'),
    readingContentWrapper: document.getElementById('reading-content-wrapper')
};

async function init() {
    try {
        // MODIFICATION: Show loading state while fetching story data
        const loadingEl = document.getElementById('loading-message');
        if (loadingEl) loadingEl.style.display = 'block';
        
        await fetchStoryData();
        
        if (loadingEl) loadingEl.style.display = 'none';
    } catch (error) {
        console.error('Error loading story data:', error);
        // MODIFICATION: Fallback to empty stories and disable reading practice
        state.storyData = [];
        dom.btnReading.disabled = true;
        dom.btnReading.title = 'Story data unavailable';
    }
    
    bindEvents();
    updateQuizTypeMenu();
    updateReadingButton();
    startFloatingLogo();
    
    // MODIFICATION: Show help modal on first visit
    if (!localStorage.getItem('hasSeenHelp')) {
        showHelp();
    }
}

function processStoryData(rawStoryData) {
    const tempMap = {};
    // MODIFICATION: Added data validation to prevent silent failures on malformed entries
    for (const key in rawStoryData) {
        if (!key || typeof rawStoryData[key] !== 'string') continue;
        const parts = key.split('.');
        if (parts.length >= 3) {
            const storyId = parts[1];
            const type = parts[2];
            if (!tempMap[storyId]) tempMap[storyId] = { id: storyId };
            if (type === '5') tempMap[storyId].title = rawStoryData[key];
            if (type === '7') tempMap[storyId].text = rawStoryData[key];
        }
    }
    state.storyData = Object.values(tempMap).filter(s => s.title && s.text);
    console.warn(`Loaded ${state.storyData.length} valid stories`);
}

function bindEvents() {
    document.getElementById('btn-help').addEventListener('click', showHelp);
    document.getElementById('btn-close-help').addEventListener('click', hideHelp);
    dom.helpModal.addEventListener('click', e => { if (e.target === dom.helpModal) hideHelp(); });

    document.querySelectorAll('input[name="interaction"]').forEach(el => el.addEventListener('change', updateQuizTypeMenu));
    document.querySelectorAll('input[name="charset"]').forEach(el => el.addEventListener('change', updateReadingButton));
    
    dom.quizTypeMenu.addEventListener('change', e => {
        if (e.target.name === 'quiztype') {
            const interaction = document.querySelector('input[name="interaction"]:checked').value;
            if (interaction === 'write') state.writeQuizType = e.target.value;
            else state.selectQuizType = e.target.value;
        }
    });

    dom.btnReading.addEventListener('click', startReadingMode);
    document.getElementById('btn-start-game').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);
    document.querySelectorAll('.btn-menu').forEach(btn => btn.addEventListener('click', showMenu));

    document.getElementById('btn-focus').addEventListener('click', toggleFocus);
    document.getElementById('btn-submit').addEventListener('click', handleWriteAction);
    
    dom.optionBtns.forEach(btn => btn.addEventListener('click', e => handleSelectAction(e.target.dataset.index)));

    document.getElementById('btn-prev').addEventListener('click', prevStory);
    document.getElementById('btn-next').addEventListener('click', nextStory);
    document.getElementById('btn-random').addEventListener('click', randomStory);

    // MODIFICATION: Store reference to handler for cleanup to prevent memory leak when screens change
    globalKeydownHandler = handleGlobalKeys;
    document.addEventListener("keydown", globalKeydownHandler);
}

// MODIFICATION: Fetch story data from JSON file
async function fetchStoryData() {
    const response = await fetch('assets/story/DatingCharacterEvent.json');
    if (!response.ok) throw new Error(`Failed to fetch story data: ${response.status}`);
    
    const rawStoryData = await response.json();
    processStoryData(rawStoryData);
}

function updateReadingButton() {
    const setMode = document.querySelector('input[name="charset"]:checked').value;
    dom.btnReading.disabled = ['numbers', 'upper-lower'].includes(setMode);
}

function startReadingMode() {
    stopFloatingLogo();
    applyFontSelection();
    toggleScreens(dom.readingScreen);

    if (state.storyData.length === 0) {
        dom.readingError.classList.remove('hidden');
        dom.readingContentWrapper.classList.add('hidden');
    } else {
        dom.readingError.classList.add('hidden');
        dom.readingContentWrapper.classList.remove('hidden');
        randomStory();
    }
}

// MODIFICATION: Wrap each word with tooltip spans for font translation on hover/tap
// Only wraps actual words and numbers, ignoring punctuation
function createReadingWithTooltips(text) {
    // Replace only words and numbers, leaving punctuation and whitespace unchanged
    // \w+ matches word characters (letters, digits) and preserves all symbols around them
    return text.replace(/(\w+)/g, '<span class="reading-word" data-translation="$1">$1</span>');
}

// MODIFICATION: Bind hover and tap events to reading words for tooltip interaction
function bindReadingTooltips() {
    const words = document.querySelectorAll('.reading-word');

    // MODIFICATION: Delay binding to prevent touch propagation from button press
    setTimeout(() => {
        words.forEach(word => {
            // Desktop: hover to show tooltip
            word.addEventListener('mouseenter', () => {
                if (currentReadingTooltip) currentReadingTooltip.remove();
                currentReadingTooltip = showReadingTooltip(word);
            });

            word.addEventListener('mouseleave', () => {
                if (currentReadingTooltip) {
                    currentReadingTooltip.remove();
                    currentReadingTooltip = null;
                }
            });

            // Mobile: tap to show tooltip
            word.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentReadingTooltip) {
                    currentReadingTooltip.remove();
                    currentReadingTooltip = null;
                } else {
                    currentReadingTooltip = showReadingTooltip(word);
                }
            });
        });
    }, 150);
}

// MODIFICATION: Create and position tooltip for reading word
function showReadingTooltip(wordElement) {
    const tooltip = document.createElement('div');
    tooltip.className = 'reading-tooltip';
    tooltip.textContent = wordElement.dataset.translation;
    // Use regular font for tooltip (not alien font)
    tooltip.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
    
    document.body.appendChild(tooltip);
    
    // Position tooltip above the word
    const rect = wordElement.getBoundingClientRect();
    tooltip.style.left = (rect.left + rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - 10) + 'px';
    
    return tooltip;
}

function displayCurrentStory() {
    if (state.storyData.length === 0) return;
    // MODIFICATION: Added bounds checking and validation to prevent undefined story access
    if (state.currentStoryIndex < 0 || state.currentStoryIndex >= state.storyData.length) {
        console.error('Invalid story index:', state.currentStoryIndex);
        return;
    }
    const story = state.storyData[state.currentStoryIndex];
    if (!story || !story.title || !story.text) {
        console.error('Story data incomplete:', story);
        return;
    }
    
    // MODIFICATION: Clear any active tooltip before displaying new story
    if (currentReadingTooltip) {
        currentReadingTooltip.remove();
        currentReadingTooltip = null;
    }
    
    const setMode = document.querySelector('input[name="charset"]:checked').value;
    
    dom.readingImage.style.display = "block";
    dom.readingImage.src = `assets/story/datingeventcg/DatingSPCG_${story.id}.webp`;
    
    let displayTitle = story.title;
    let displayText = story.text;

    if (setMode === 'uppercase') {
        displayTitle = displayTitle.toUpperCase();
        displayText = displayText.toUpperCase();
    } else if (setMode === 'lowercase') {
        displayTitle = displayTitle.toLowerCase();
        displayText = displayText.toLowerCase();
    }

    // MODIFICATION: Apply tooltips to title as well
    dom.readingTitle.innerHTML = createReadingWithTooltips(displayTitle);
    // MODIFICATION: Wrap words with interactive tooltips for font translation
    dom.readingText.innerHTML = createReadingWithTooltips(displayText);
    dom.readingScreen.scrollTop = 0;
    // MODIFICATION: Bind tooltip events after HTML is set
    bindReadingTooltips();
}

function nextStory() {
    if (state.storyData.length === 0) return;
    state.currentStoryIndex = (state.currentStoryIndex + 1) % state.storyData.length;
    displayCurrentStory();
}

function prevStory() {
    if (state.storyData.length === 0) return;
    state.currentStoryIndex = (state.currentStoryIndex - 1 + state.storyData.length) % state.storyData.length;
    displayCurrentStory();
}

function randomStory() {
    if (state.storyData.length === 0) return;
    state.currentStoryIndex = Math.floor(Math.random() * state.storyData.length);
    displayCurrentStory();
}

function showHelp() {
    dom.helpModal.style.display = 'flex';
    setTimeout(() => { dom.helpModal.style.opacity = '1'; }, 10);
}

function hideHelp() {
    dom.helpModal.style.opacity = '0';
    setTimeout(() => { dom.helpModal.style.display = 'none'; }, 300);
    // MODIFICATION: Remember that user has seen help so it doesn't show again
    localStorage.setItem('hasSeenHelp', 'true');
}

function spawnFloatingLogo() {
    if (!state.isLogoFloating || state.currentLogosCount >= state.maxLogos) return;

    state.currentLogosCount++;
    const img = document.createElement('img');
    img.src = backgroundImages[Math.floor(Math.random() * backgroundImages.length)];
    img.className = 'floating-logo';
    document.body.appendChild(img);

    img.onload = () => {
        const maxX = Math.max(0, window.innerWidth - img.clientWidth);
        const maxY = Math.max(0, window.innerHeight - img.clientHeight);
        img.style.left = Math.floor(Math.random() * maxX) + 'px';
        img.style.top = Math.floor(Math.random() * maxY) + 'px';
        
        const driftX = (Math.random() - 0.5) * 300;
        const driftY = (Math.random() - 0.5) * 300;

        setTimeout(() => {
            if (!state.isLogoFloating) return;
            img.style.opacity = '0.3'; 
            img.style.transform = `translate(${driftX}px, ${driftY}px)`;
        }, 100);

        setTimeout(() => {
            img.style.opacity = '0'; 
            setTimeout(() => {
                if (img.parentNode) {
                    img.parentNode.removeChild(img);
                    state.currentLogosCount--;
                }
            }, 2000); 
        }, 5000 + Math.random() * 3000); 
    };
    
    img.onerror = () => {
        img.parentNode?.removeChild(img);
        state.currentLogosCount--;
    };
}

function startFloatingLogo() {
    if (state.isLogoFloating) return; 
    state.isLogoFloating = true;
    spawnFloatingLogo();
    state.logoSpawnInterval = setInterval(spawnFloatingLogo, 2500);
}

function stopFloatingLogo() {
    state.isLogoFloating = false;
    clearInterval(state.logoSpawnInterval);
    // MODIFICATION: Added proper cleanup of floating logo event listeners to prevent memory leaks
    document.querySelectorAll('.floating-logo').forEach(logo => {
        logo.onload = null;  // Clear onload listener
        logo.onerror = null; // Clear error handler
        logo.style.opacity = '0';
        setTimeout(() => {
            if (logo.parentNode) {
                logo.parentNode.removeChild(logo);
                state.currentLogosCount--;
            }
        }, 2000);
    });
}

function updateQuizTypeMenu() {
    const interaction = document.querySelector('input[name="interaction"]:checked').value;
    
    if (interaction === 'write') {
        const isCombined = state.writeQuizType === 'combined';
        dom.quizTypeMenu.innerHTML = `
            <h3>Quiz Type</h3>
            <label class="radio-label">
                <input type="radio" name="quiztype" value="standard" ${!isCombined ? 'checked' : ''}> 
                <img src="assets/icons/icon-standard.png" class="custom-icon" alt=""> Standard
            </label>
            <label class="radio-label">
                <input type="radio" name="quiztype" value="combined" ${isCombined ? 'checked' : ''}> 
                <img src="assets/icons/icon-combined.png" class="custom-icon" alt=""> Combined
            </label>
        `;
        dom.upperLowerLabel.classList.add('hidden');
        if (document.querySelector('input[name="charset"]:checked').value === 'upper-lower') {
            document.querySelector('input[value="uppercase"]').checked = true;
        }
    } else {
        const isReversed = state.selectQuizType === 'reversed';
        dom.quizTypeMenu.innerHTML = `
            <h3>Quiz Type</h3>
            <label class="radio-label">
                <input type="radio" name="quiztype" value="standard" ${!isReversed ? 'checked' : ''}> 
                <img src="assets/icons/icon-standard.png" class="custom-icon" alt=""> Standard
            </label>
            <label class="radio-label">
                <input type="radio" name="quiztype" value="reversed" ${isReversed ? 'checked' : ''}> 
                <img src="assets/icons/icon-reversed.png" class="custom-icon" alt=""> Reversed
            </label>
        `;
        dom.upperLowerLabel.classList.remove('hidden');
    }
    updateReadingButton();
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function getDistractors(correctAnswer, pool, count) {
    let distractors = [];
    while (distractors.length < count) {
        let randomChar = pool[Math.floor(Math.random() * pool.length)];
        if (randomChar !== correctAnswer && !distractors.includes(randomChar)) {
            distractors.push(randomChar);
        }
    }
    return distractors;
}

function formatTime(totalSeconds) {
    return `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

function startTimer() {
    clearInterval(state.timerInterval);
    state.secondsElapsed = 0;
    dom.timerElement.textContent = "00:00";
    state.timerInterval = setInterval(() => {
        state.secondsElapsed++;
        dom.timerElement.textContent = formatTime(state.secondsElapsed);
    }, 1000);
}

function toggleFocus() {
    state.isFocusMode = !state.isFocusMode;
    applyFocusState();
    if (state.interactionMode === 'write' && !dom.gameScreen.classList.contains('hidden')) {
        dom.inputElement.focus();
    }
}

function applyFocusState() {
    if (state.isFocusMode) {
        dom.gameScreen.classList.add('focus-active');
        dom.focusIconImg.src = "assets/icons/icon-eye-closed.png";
    } else {
        dom.gameScreen.classList.remove('focus-active');
        dom.focusIconImg.src = "assets/icons/icon-eye-open.png";
    }
}

function toggleScreens(activeScreen) {
    [dom.mainMenu, dom.gameScreen, dom.readingScreen].forEach(s => s.classList.add('hidden'));
    activeScreen.classList.remove('hidden');
}

function showMenu() {
    clearInterval(state.timerInterval);
    toggleScreens(dom.mainMenu);
    dom.lastResultElement.innerHTML = "";
    startFloatingLogo();
}

function applyFontSelection() {
    const fontChoice = document.querySelector('input[name="font-option"]:checked').value;
    const activeFont = fontChoice === 'print' ? "'CustomPrint', sans-serif" : "'CustomCursive', sans-serif";
    document.documentElement.style.setProperty('--alien-font', activeFont);
}

function startGame() {
    stopFloatingLogo();
    state.interactionMode = document.querySelector('input[name="interaction"]:checked').value;
    state.activeSetMode = document.querySelector('input[name="charset"]:checked').value;
    state.quizType = document.querySelector('input[name="quiztype"]:checked').value;
    
    applyFontSelection();
    
    const srsLevel = parseInt(dom.srsSelect.value);
    state.minList = srsLevel === 0 ? 0 : -srsLevel;
    state.maxList = srsLevel === 0 ? 1 : srsLevel;

    toggleScreens(dom.gameScreen);
    
    // MODIFICATION: Added pool initialization with validation
    if (state.activeSetMode === 'numbers') state.currentPool = [...numbersList];
    else if (['uppercase', 'upper-lower'].includes(state.activeSetMode)) state.currentPool = [...uppercaseList];
    else if (state.activeSetMode === 'lowercase') state.currentPool = [...lowercaseList];
    else if (state.activeSetMode === 'combined') state.currentPool = [...numbersList, ...uppercaseList, ...lowercaseList];
    else {
        // MODIFICATION: Fallback to lowercase if invalid mode
        console.error('Invalid charset mode:', state.activeSetMode);
        state.currentPool = [...lowercaseList];
    }

    // MODIFICATION: Validate pool is not empty before starting game
    if (!state.currentPool || state.currentPool.length === 0) {
        console.error('Character pool is empty!');
        showMenu();
        return;
    }

    state.srsLists = {};
    for (let i = state.minList; i <= state.maxList; i++) state.srsLists[i] = [];

    let startQueue = [...state.currentPool];
    shuffleArray(startQueue);
    state.srsLists[0] = startQueue;
    state.currentListIdx = 0;

    state.score = state.attempts = 0;
    dom.scoreElement.textContent = state.score;
    dom.attemptsElement.textContent = state.attempts;
    
    if (state.interactionMode === 'write') {
        dom.writeUI.classList.remove('hidden');
        dom.selectUI.classList.add('hidden');
        dom.displayElement.style.fontFamily = "var(--alien-font)";
    } else {
        dom.writeUI.classList.add('hidden');
        dom.selectUI.classList.remove('hidden');
        
        if (state.activeSetMode === 'upper-lower') {
            dom.displayElement.style.fontFamily = "var(--alien-font)";
            dom.optionBtns.forEach(btn => btn.style.fontFamily = "var(--alien-font)");
        } else if (state.quizType === 'reversed') {
            dom.displayElement.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
            dom.optionBtns.forEach(btn => btn.style.fontFamily = "var(--alien-font)");
        } else {
            dom.displayElement.style.fontFamily = "var(--alien-font)";
            dom.optionBtns.forEach(btn => btn.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif");
        }
    }

    dom.feedbackElement.textContent = "";
    dom.lastResultElement.innerHTML = "";
    document.getElementById('btn-focus').style.display = "block";
    applyFocusState();
    startTimer();
    nextRound();
}

function nextRound() {
    if (state.interactionMode === 'write') {
        dom.inputElement.value = '';
        dom.inputElement.focus();
    }

    let remainingTotal = state.currentPool.length - state.srsLists[state.maxList].length;
    dom.remainingElement.textContent = remainingTotal;

    if (remainingTotal === 0) return gameWon();

    if (state.currentListIdx === null || state.srsLists[state.currentListIdx].length === 0) {
        state.currentListIdx = null;
        for (let i = state.minList; i < state.maxList; i++) {
            if (state.srsLists[i].length > 0) {
                state.currentListIdx = i;
                break;
            }
        }
    }

    // MODIFICATION: Guard against null currentListIdx which can cause crashes
    if (state.currentListIdx === null || !state.srsLists.hasOwnProperty(state.currentListIdx)) {
        console.error('No valid SRS list found, ending game');
        return gameWon();
    }

    // MODIFICATION: Shuffle the current list to prevent users from memorizing character order
    shuffleArray(state.srsLists[state.currentListIdx]);

    let queue = state.srsLists[state.currentListIdx];

    if (state.interactionMode === 'write' && state.quizType === 'combined') {
        const count = Math.min(3, queue.length);
        state.currentTargets = queue.slice(0, count);
        dom.displayElement.textContent = state.currentTargets.join('');
        dom.inputElement.maxLength = count;
    } else {
        state.currentTargets = [queue[0]];
        let displayChar = state.currentTargets[0];
        
        if (state.interactionMode === 'select' && state.activeSetMode === 'upper-lower' && state.quizType === 'reversed') {
            displayChar = displayChar.toLowerCase();
        }
        
        dom.displayElement.textContent = displayChar;
        if (state.interactionMode === 'write') dom.inputElement.maxLength = 1;
    }

    if (state.interactionMode === 'select') {
        let options = getDistractors(state.currentTargets[0], state.currentPool, 2);
        options.push(state.currentTargets[0]);
        shuffleArray(options);
        
        if (state.activeSetMode === 'upper-lower' && state.quizType === 'standard') {
            options = options.map(c => c.toLowerCase());
        }

        dom.optionBtns.forEach((btn, i) => btn.textContent = options[i]);
    }
}

function handleWriteAction() {
    const guess = dom.inputElement.value;
    const expectedStr = state.currentTargets.join('');
    
    if (guess === '') return;

    state.attempts++;
    state.srsLists[state.currentListIdx].splice(0, state.currentTargets.length);

    if (guess === expectedStr) {
        state.score++;
        dom.lastResultElement.innerHTML = "";
        dom.lastResultElement.style.color = "";
        
        let nextList = Math.min(state.maxList, state.currentListIdx + 1);
        state.currentTargets.forEach(char => state.srsLists[nextList].push(char));
    } else {
        if (state.quizType === 'combined' && state.currentTargets.length > 1) {
            const guessChars = guess.split('');
            let feedbackHtml = '';
            state.currentTargets.forEach((char, i) => {
                const ok = guessChars[i] === char;
                feedbackHtml += `<span class="alien-inline" style="color:${ok ? 'var(--success)' : 'var(--error)'}">${char}</span>`;
            });
            dom.lastResultElement.innerHTML = `${feedbackHtml} = <b>${expectedStr}</b>`;
        } else {
            dom.lastResultElement.innerHTML = `<span class="alien-inline">${expectedStr}</span> = <b>${expectedStr}</b>`;
            dom.lastResultElement.style.color = "var(--error)";
        }
        
        let guessChars = guess.split('');
        state.currentTargets.forEach((char, index) => {
            if (guessChars[index] === char) {
                state.srsLists[Math.min(state.maxList, state.currentListIdx + 1)].push(char);
            } else {
                state.srsLists[Math.max(state.minList, state.currentListIdx - 1)].push(char);
            }
        });
    }

    dom.scoreElement.textContent = state.score;
    dom.attemptsElement.textContent = state.attempts;
    nextRound();
}

function handleSelectAction(btnIndex) {
    // MODIFICATION: Clear button focus to prevent persistent highlight on mobile
    document.activeElement.blur();
    
    const guess = document.getElementById(`opt-${btnIndex}`).textContent;
    const expectedChar = state.currentTargets[0];
    state.attempts++;

    state.srsLists[state.currentListIdx].shift();
    const isUpperLower = state.activeSetMode === 'upper-lower';
    
    let expectedOptionText = expectedChar;
    let expectedDisplayText = expectedChar;
    
    if (isUpperLower) {
        if (state.quizType === 'standard') expectedOptionText = expectedChar.toLowerCase();
        else if (state.quizType === 'reversed') expectedDisplayText = expectedChar.toLowerCase();
    }

    if (guess.toLowerCase() === expectedChar.toLowerCase()) {
        state.score++;
        dom.lastResultElement.innerHTML = "";
        dom.lastResultElement.style.color = "";
        state.srsLists[Math.min(state.maxList, state.currentListIdx + 1)].push(expectedChar);
    } else {
        if (isUpperLower) {
             dom.lastResultElement.innerHTML = `<span class="alien-inline">${expectedDisplayText}</span> = <span class="alien-inline">${expectedOptionText}</span>`;
        } else if (state.quizType === 'reversed') {
            dom.lastResultElement.innerHTML = `<b>${expectedDisplayText}</b> = <span class="alien-inline">${expectedOptionText}</span>`;
        } else {
            dom.lastResultElement.innerHTML = `<span class="alien-inline">${expectedDisplayText}</span> = <b>${expectedOptionText}</b>`;
        }
        
        dom.lastResultElement.style.color = "var(--error)";
        state.srsLists[Math.max(state.minList, state.currentListIdx - 1)].push(expectedChar);
    }

    dom.scoreElement.textContent = state.score;
    dom.attemptsElement.textContent = state.attempts;
    nextRound();
}

function gameWon() {
    clearInterval(state.timerInterval);
    dom.gameScreen.classList.remove('focus-active');
    document.getElementById('btn-focus').style.display = "none"; 
    dom.lastResultElement.innerHTML = "";
    
    const accuracy = Math.round((state.score / state.attempts) * 100) || 0;
    const trophyImgs = { 100: '100', 75: '75', 50: '50', 25: '25', 0: '0' };
    const bracket = Object.keys(trophyImgs).reverse().find(val => accuracy >= val);
    
    dom.displayElement.innerHTML = `<img src="assets/icons/icon-trophy${bracket}.png" class="icon-trophy">`;
    dom.feedbackElement.textContent = `Accuracy: ${accuracy}% | Time: ${formatTime(state.secondsElapsed)}`;
    dom.feedbackElement.style.color = "var(--text-main)";
    
    dom.writeUI.classList.add('hidden');
    dom.selectUI.classList.add('hidden');
}

function handleGlobalKeys(event) {
    if (dom.helpModal.style.display === "flex" && event.key === "Escape") return hideHelp();

    if (!dom.readingScreen.classList.contains('hidden')) {
        if (event.key === "ArrowRight") nextStory();
        if (event.key === "ArrowLeft") prevStory();
        if (event.key === "Escape") showMenu();
        return;
    }

    if (dom.gameScreen.classList.contains('hidden')) return;
    
    if (event.key === "Enter" && state.interactionMode === 'write') {
        event.preventDefault();
        handleWriteAction();
    }

    if (state.interactionMode === 'select') {
        if (event.key === "1") handleSelectAction(0);
        if (event.key === "2") handleSelectAction(1);
        if (event.key === "3") handleSelectAction(2);
    }
}

window.addEventListener('DOMContentLoaded', init);
