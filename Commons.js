﻿const strategy = require('./Integrations/Strategy')

exports.newCommons = function newCommons(bot, logger, UTILITIES) {

    const { orderMessage } = require("@superalgos/mqservice")

    const {
      MESSAGE_ENTITY, MESSAGE_TYPE, ORDER_CREATOR, ORDER_TYPE,
            ORDER_OWNER, ORDER_DIRECTION, ORDER_STATUS, ORDER_EXIT_OUTCOME,
            createMessage, getMessage, getExpandedMessage
    } = orderMessage.newOrderMessage()


    const FULL_LOG = true;
    const LOG_FILE_CONTENT = false;

    const MODULE_NAME = "Commons";
    const ONE_DAY_IN_MILISECONDS = 24 * 60 * 60 * 1000;
    const GMT_SECONDS = ':00.000 GMT+0000';

    let thisObject = {
        initializeData: initializeData,
        runSimulation: runSimulation,
        buildLRC: buildLRC,
        buildPercentageBandwidthMap: buildPercentageBandwidthMap,
        buildBollingerBandsMap: buildBollingerBandsMap,
        buildBollingerChannelsArray: buildBollingerChannelsArray,
        buildBollingerSubChannelsArray: buildBollingerSubChannelsArray,
        buildCandles: buildCandles
    };

    let utilities = UTILITIES.newCloudUtilities(bot, logger);

    let LRCMap = new Map();
    let percentageBandwidthMap = new Map();
    let bollingerBandsMap = new Map();
    let bollingerChannelsArray = [];
    let bollingerSubChannelsArray = [];

    let candles = [];

    return thisObject;

    function initializeData() {

        LRCMap = new Map();
        percentageBandwidthMap = new Map();
        bollingerBandsMap = new Map();
        bollingerChannelsArray = [];
        bollingerSubChannelsArray = [];

        candles = [];
    }

    async function runSimulation(
        recordsArray,
        conditionsArray,
        strategiesArray,
        tradesArray,
        lastObjectsArray,
        timePeriod,
        currentDay,
        startDate,
        endDate,
        interExecutionMemory,
        callback) {

        try {

            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> Entering function."); }

            let tradingSystem = await strategy.getStrategy();

            /* Initial Default Values */

            let initialDate = startDate;    

            const DEFAULT_BASE_ASSET_BALANCE = 1
            const DEFAULT_BASE_ASSET_MINIMUN_BALANCE = 0.5
            const DEFAULT_BASE_ASSET_MAXIMUN_BALANCE = 2

            let initialBalanceA = DEFAULT_BASE_ASSET_BALANCE
            let minimunBalanceA = DEFAULT_BASE_ASSET_MINIMUN_BALANCE
            let maximunBalanceA = DEFAULT_BASE_ASSET_MAXIMUN_BALANCE
            let initialBalanceB = 0
            let minimunBalanceB = 0
            let maximunBalanceB = 0
            let baseAsset = 'BTC'

            /* Parameters Processing */

            if (tradingSystem.parameters !== undefined) {
                if (tradingSystem.parameters.baseAsset !== undefined) {
                    if (tradingSystem.parameters.baseAsset.formula !== undefined) {
                        let receivedParameters 
                        try {
                            receivedParameters = JSON.parse(tradingSystem.parameters.baseAsset.formula.code);

                            if (receivedParameters.name !== undefined) {
                                baseAsset = receivedParameters.name;
                                if (baseAsset !== 'BTC' && baseAsset !== 'USDT') {
                                    tradingSystem.parameters.baseAsset.formula.error = baseAsset + ' is not supported. Using default: BTC.'
                                    baseAsset = 'BTC'
                                }
                            }

                            if (baseAsset === 'BTC') {
                                if (receivedParameters.initialBalance !== undefined) {
                                    initialBalanceA = receivedParameters.initialBalance;
                                    initialBalanceB = 0
                                } else {
                                    initialBalanceA = DEFAULT_BASE_ASSET_BALANCE;
                                    initialBalanceB = 0
                                }
                                if (receivedParameters.minimunBalance !== undefined) {
                                    minimunBalanceA = receivedParameters.minimunBalance;
                                    minimunBalanceB = 0
                                } else {
                                    minimunBalanceA = DEFAULT_BASE_ASSET_MINIMUN_BALANCE;
                                    minimunBalanceB = 0
                                }
                                if (receivedParameters.maximunBalance !== undefined) {
                                    maximunBalanceA = receivedParameters.maximunBalance;
                                    maximunBalanceB = 0
                                } else {
                                    maximunBalanceA = DEFAULT_BASE_ASSET_MAXIMUN_BALANCE;
                                    maximunBalanceB = 0
                                }
                            } else {
                                if (receivedParameters.initialBalance !== undefined) {
                                    initialBalanceB = receivedParameters.initialBalance;
                                    initialBalanceA = 0
                                } else {
                                    initialBalanceB = DEFAULT_BASE_ASSET_BALANCE;
                                    initialBalanceA = 0
                                }
                                if (receivedParameters.minimunBalance !== undefined) {
                                    minimunBalanceB = receivedParameters.minimunBalance;
                                    minimunBalanceA = 0
                                } else {
                                    minimunBalanceB = DEFAULT_BASE_ASSET_MINIMUN_BALANCE;
                                    minimunBalanceA = 0
                                }
                                if (receivedParameters.maximunBalance !== undefined) {
                                    maximunBalanceB = receivedParameters.maximunBalance;
                                    maximunBalanceA = 0
                                } else {
                                    maximunBalanceB = DEFAULT_BASE_ASSET_MAXIMUN_BALANCE;
                                    maximunBalanceA = 0
                                }
                            }
                        } catch (err) {
                            tradingSystem.parameters.baseAsset.formula.error = err.message
                        }
                    }
                }
            }

            /* Strategy and Phases */

            let currentStrategyIndex = -1;
            let strategyStage = 'No Stage';   

            /* Stop Loss Management */

            const MIN_STOP_LOSS_VALUE = 1 // We can not let the stop be zero to avoid division by 0 error or infinity numbers as a result.
            const MAX_STOP_LOSS_VALUE = Number.MAX_SAFE_INTEGER
            let stopLoss = 0;
            let stopLossPhase = 0;
            let stopLossStage = 'No Stage';  

            /* Take Profit Management */

            const MIN_TAKE_PROFIT_VALUE = 1 // We can not let the buy order be zero to avoid division by 0 error or infinity numbers as a result.
            const MAX_TAKE_PROFIT_VALUE = Number.MAX_SAFE_INTEGER
            let previousTakeProfit = 0;
            let takeProfit = 0;
            let takeProfitPhase = 0;
            let takeProfitStage = 'No Stage';  

            /* Simulation Records */

            let positionRate = 0;
            let positionSize = 0;
            let positionInstant;

            let previousBalanceAssetA = 0;
            let previousBalanceAssetB = 0;
            let hitRatio = 0;
            let ROI = 0;
            let days = 0;
            let anualizedRateOfReturn = 0;
            let type = '""';
            let marketRate = 0;
            let takePositionNow = false

            /* In some cases we need to know if we are positioned at the last candle of the calendar day, for that we need thse variables. */

            let lastInstantOfTheDay = currentDay.valueOf() + ONE_DAY_IN_MILISECONDS - 1;
            let lastCandle = candles[candles.length - 1];

            /* These 2 objects will allow us to create separate files for each one of them. */

            let currentStrategy = {
                begin: 0,
                end: 0,
                status: 0,
                number: 0
            }

            let currentTrade = {
                begin: 0,
                end: 0,
                status: 0,
                profit: 0,
                exitType: 0,
                beginRate: 0,
                endRate: 0
            }

            /*
            The following counters need to survive multiple executions of the similator and keep themselves reliable.
            This is challenging when the simulation is executed using Daily Files, since each execution means a new
            day and these counters are meant to be kept along the whole market.

            To overcome this problem, we use the interExecutionMemory to record the values of the current execution
            when finish. But there are a few details:

            1. When the process is at the head of the market, it executes multple times at the same day.
            2. The same code serves execution from Market Files.
            3. In Daily Files we are receiving candles from the current day and previous day, so we need to take care of
               not adding to the counters duplicate info when processing the day before candles.

            To overcome these challenges we record the values of the counters and variables on the interExecutionMemory only when
            the day is complete and if we have a currentDay. That menas that for Market Files we will never use
            interExecutionMemory.
            */

            let balanceAssetA = initialBalanceA;
            let balanceAssetB = initialBalanceB;

            let lastProfit = 0;
            let profit = 0;
            let lastProfitPercent = 0;

            let roundtrips = 0;
            let fails = 0;
            let hits = 0;
            let periods = 0;

            /* Message to the Simulation Executor */

            let orderId = 0;
            let messageId = 0;

            let yesterday = {};

            yesterday.balanceAssetA = balanceAssetA;
            yesterday.balanceAssetB = balanceAssetB;

            yesterday.lastProfit = 0;
            yesterday.profit = 0;
            yesterday.lastProfitPercent = 0;

            yesterday.Roundtrips = 0;
            yesterday.fails = 0;
            yesterday.hits = 0;
            yesterday.Periods = 0;

            yesterday.orderId = 0;
            yesterday.messageId = 0;

            yesterday.hitRatio = 0;
            yesterday.ROI = 0;
            yesterday.anualizedRateOfReturn = 0;

            if (interExecutionMemory.roundtrips === undefined) {

                /* Initialize the data structure we will use inter execution. */

                interExecutionMemory.balanceAssetA = balanceAssetA;
                interExecutionMemory.balanceAssetB = balanceAssetB;

                interExecutionMemory.lastProfit = lastProfit;
                interExecutionMemory.profit = profit;
                interExecutionMemory.lastProfitPercent = lastProfitPercent;

                interExecutionMemory.roundtrips = 0;
                interExecutionMemory.fails = 0;
                interExecutionMemory.hits = 0;
                interExecutionMemory.periods = 0;

                interExecutionMemory.orderId = 0;
                interExecutionMemory.messageId = 0;

                interExecutionMemory.hitRatio = 0;
                interExecutionMemory.ROI = 0;
                interExecutionMemory.anualizedRateOfReturn = 0;

            } else {

                /* We get the initial values from the day previous to the candles we receive at the current execution */

                if (currentDay.valueOf() >= startDate.valueOf() + ONE_DAY_IN_MILISECONDS) { // Only after the first day we start grabbing the balance from this memory.

                    balanceAssetA = interExecutionMemory.balanceAssetA;
                    balanceAssetB = interExecutionMemory.balanceAssetB;

                    yesterday.balanceAssetA = balanceAssetA;
                    yesterday.balanceAssetB = balanceAssetB;

                } 
                
                lastProfit = interExecutionMemory.lastProfit;
                profit = interExecutionMemory.profit;
                lastProfitPercent = interExecutionMemory.lastProfitPercent;

                roundtrips = interExecutionMemory.roundtrips;
                fails = interExecutionMemory.fails;
                hits = interExecutionMemory.hits;
                periods = interExecutionMemory.periods;

                orderId = interExecutionMemory.orderId;
                messageId = interExecutionMemory.messageId;

                hitRatio = interExecutionMemory.hitRatio;
                ROI = interExecutionMemory.ROI;
                anualizedRateOfReturn = interExecutionMemory.anualizedRateOfReturn;

                yesterday.hitRatio = hitRatio;
                yesterday.ROI = ROI;
                yesterday.anualizedRateOfReturn = anualizedRateOfReturn;
                
            }
           
            /* Main Simulation Loop: We go thourgh all the candles at this time period. */

            for (let i = 0; i < candles.length; i++) {

                /* Update all the data objects available for the simulation. */

                let candle = candles[i];
                let percentageBandwidth = percentageBandwidthMap.get(candle.begin);
                let bollingerBand = bollingerBandsMap.get(candle.begin);
                //let LRC = LRCMap.get(candle.begin);

                //if (LRC === undefined) { continue; }
                if (percentageBandwidth === undefined) { continue; } // percentageBandwidth might start after the first few candles.
                if (candle.begin < initialDate.valueOf()) { continue; }

                periods++;
                days = periods * timePeriod / ONE_DAY_IN_MILISECONDS;

                if (currentDay !== undefined) {
                    if (candle.end < currentDay.valueOf()) {
                        yesterday.Periods++;
                    }
                }

                let channel = getElement(bollingerChannelsArray, candle.begin, candle.end);
                let subChannel = getElement(bollingerSubChannelsArray, candle.begin, candle.end);

                let lastObjects = {
                    candle: clone(candle),
                    //LRC: clone(LRC),
                    bollingerBand: clone(bollingerBand),
                    percentageBandwidth: clone(percentageBandwidth),
                    channel: clone(channel),
                    subChannel: clone(subChannel)
                }

                function clone(obj) {
                    if (null == obj || "object" != typeof obj) return obj;
                    var copy = obj.constructor();
                    for (var attr in obj) {
                        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
                    }
                    return copy;
                }

                lastObjects.candle.previous = undefined;
                //lastObjects.LRC.previous = undefined;
                lastObjects.bollingerBand.previous = undefined;
                lastObjects.percentageBandwidth.previous = undefined;
                lastObjects.channel.previous = undefined;
                lastObjects.subChannel.previous = undefined;

                lastObjectsArray.push(lastObjects);

                if (lastObjectsArray.length > 5) {
                    lastObjectsArray.splice(0,1);
                }

                let conditions = new Map;       // Here we store the conditions values that will be use in the simulator for decision making.
                let formulas = new Map;
                let conditionsArrayRecord = []; // These are the records that will be saved in a file for the plotter to consume.
                let conditionsArrayValues = []; // Here we store the conditions values that will be written on file for the plotter.
                let formulasErrors = []; // Here we store the errors produced by all phase formulas.
                let formulasValues = []; // Here we store the values produced by all phase formulas.

                /* We set some variables that would be nice if they have a value before the formulas are calculated. */

                if (strategyStage === 'Trigger Stage') {

                    positionRate = candle.close;

                }

                /* We define and evaluate all conditions to be used later during the simulation loop. */

                conditionsArrayRecord.push(candle.begin);
                conditionsArrayRecord.push(candle.end);

                evaluateConditionsAndFormulas(tradingSystem, conditions);

                function evaluateConditionsAndFormulas(tradingSystem, conditions) {

                    for (let j = 0; j < tradingSystem.strategies.length; j++) {

                        let strategy = tradingSystem.strategies[j];

                        let triggerStage = strategy.triggerStage

                        if (triggerStage !== undefined) {

                            if (triggerStage.triggerOn !== undefined) {

                                for (let k = 0; k < triggerStage.triggerOn.situations.length; k++) {

                                    let situation = triggerStage.triggerOn.situations[k];

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + 'triggerStage' + '-' + 'triggerOn' + '-' + k + '-' + m;

                                        if (condition.code !== undefined) {
                                            newCondition(key, condition.code);
                                        }
                                    }
                                }
                            }

                            if (triggerStage.triggerOff !== undefined) {

                                for (let k = 0; k < triggerStage.triggerOff.situations.length; k++) {

                                    let situation = triggerStage.triggerOff.situations[k];

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + 'triggerStage' + '-' + 'triggerOff' + '-' + k + '-' + m;

                                        if (condition.code !== undefined) {
                                            newCondition(key, condition.code);
                                        }
                                    }
                                }
                            }

                            if (triggerStage.takePosition !== undefined) {

                                for (let k = 0; k < triggerStage.takePosition.situations.length; k++) {

                                    let situation = triggerStage.takePosition.situations[k];

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + 'triggerStage' + '-' + 'takePosition' + '-' + k + '-' + m;

                                        if (condition.code !== undefined) {
                                            newCondition(key, condition.code);
                                        }
                                    }
                                }
                            }
                        }

                        let openStage = strategy.openStage

                        if (openStage !== undefined) {

                            let initialDefinition = openStage.initialDefinition

                            if (initialDefinition !== undefined) {

                                if (initialDefinition.stopLoss !== undefined) {

                                    for (let p = 0; p < initialDefinition.stopLoss.phases.length; p++) {

                                        let phase = initialDefinition.stopLoss.phases[p];

                                        /* Evaluate Formula */
                                        let formulaValue
                                        let formulaError = ''

                                        if (phase.formula !== undefined) {
                                            try {
                                                formulaValue = eval(phase.formula.code); 
                                                if (formulaValue === Infinity) {
                                                    formulaError= "Formula evaluates to Infinity."
                                                    formulaValue = MAX_STOP_LOSS_VALUE
                                                }
                                            } catch (err) {
                                                formulaError = err.message
                                            }
                                            if (isNaN(formulaValue)) { formulaValue = 0; }
                                            if (formulaValue < MIN_STOP_LOSS_VALUE) {
                                                formulaValue = MIN_STOP_LOSS_VALUE
                                            }

                                            formulasErrors.push('"' + formulaError + '"')
                                            formulasValues.push(formulaValue)
                                            let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + p;
                                            formulas.set(key, formulaValue)
                                        }

                                        /* next phase event */
                                        let nextPhaseEvent = phase.nextPhaseEvent;
                                        if (nextPhaseEvent !== undefined) {

                                            for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                                let situation = nextPhaseEvent.situations[k];

                                                for (let m = 0; m < situation.conditions.length; m++) {

                                                    let condition = situation.conditions[m];
                                                    let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                                    if (condition.code !== undefined) {
                                                        newCondition(key, condition.code);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if (initialDefinition.takeProfit !== undefined) {

                                    for (let p = 0; p < initialDefinition.takeProfit.phases.length; p++) {

                                        let phase = initialDefinition.takeProfit.phases[p];

                                        /* Evaluate Formula */
                                        let formulaValue
                                        let formulaError = ''

                                        if (phase.formula !== undefined) {
                                            try {
                                                formulaValue = eval(phase.formula.code);
                                                if (formulaValue === Infinity) {
                                                    formulaError = "Formula evaluates to Infinity."
                                                    formulaValue = MAX_TAKE_PROFIT_VALUE
                                                }
                                            } catch (err) {
                                                formulaError = err.message
                                            }
                                            if (isNaN(formulaValue)) { formulaValue = 0; }
                                            if (formulaValue < MIN_TAKE_PROFIT_VALUE) {
                                                formulaValue = MIN_TAKE_PROFIT_VALUE
                                            }

                                            formulasErrors.push('"' + formulaError + '"')
                                            formulasValues.push(formulaValue)
                                            let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + p;
                                            formulas.set(key, formulaValue)
                                        }

                                        /* next phase event */
                                        let nextPhaseEvent = phase.nextPhaseEvent;
                                        if (nextPhaseEvent !== undefined) {

                                            for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                                let situation = nextPhaseEvent.situations[k];

                                                for (let m = 0; m < situation.conditions.length; m++) {

                                                    let condition = situation.conditions[m];
                                                    let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                                    if (condition.code !== undefined) {
                                                        newCondition(key, condition.code);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        let manageStage = strategy.manageStage

                        if (manageStage !== undefined) {

                            if (manageStage.stopLoss !== undefined) {

                                for (let p = 0; p < manageStage.stopLoss.phases.length; p++) {

                                    let phase = manageStage.stopLoss.phases[p];

                                    /* Evaluate Formula */
                                    let formulaValue
                                    let formulaError = ''

                                    if (phase.formula !== undefined) {
                                        try {
                                            formulaValue = eval(phase.formula.code);
                                            if (formulaValue === Infinity) {
                                                formulaError = "Formula evaluates to Infinity."
                                                formulaValue = MAX_STOP_LOSS_VALUE
                                            }
                                        } catch (err) {
                                            formulaError = err.message
                                        }
                                        if (isNaN(formulaValue)) { formulaValue = 0; }
                                        if (formulaValue < MIN_STOP_LOSS_VALUE) {
                                            formulaValue = MIN_STOP_LOSS_VALUE
                                        }

                                        formulasErrors.push('"' + formulaError + '"')
                                        formulasValues.push(formulaValue)
                                        let key = j + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + p;
                                        formulas.set(key, formulaValue)
                                    }

                                    /* next phase event */
                                    let nextPhaseEvent = phase.nextPhaseEvent;
                                    if (nextPhaseEvent !== undefined) {

                                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                            let situation = nextPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                                if (condition.code !== undefined) {
                                                    newCondition(key, condition.code);
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if (manageStage.takeProfit !== undefined) {

                                for (let p = 0; p < manageStage.takeProfit.phases.length; p++) {

                                    let phase = manageStage.takeProfit.phases[p];

                                    /* Evaluate Formula */
                                    let formulaValue
                                    let formulaError = ''

                                    if (phase.formula !== undefined) {
                                        try {
                                            formulaValue = eval(phase.formula.code);
                                            if (formulaValue === Infinity) {
                                                formulaError = "Formula evaluates to Infinity."
                                                formulaValue = MAX_TAKE_PROFIT_VALUE
                                            }
                                        } catch (err) {
                                            formulaError = err.message
                                        }
                                        if (isNaN(formulaValue)) { formulaValue = 0; }
                                        if (formulaValue < MIN_TAKE_PROFIT_VALUE) {
                                            formulaValue = MIN_TAKE_PROFIT_VALUE
                                        }

                                        formulasErrors.push('"' + formulaError + '"')
                                        formulasValues.push(formulaValue)
                                        let key = j + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + p;
                                        formulas.set(key, formulaValue)
                                    }

                                    /* next phase event */
                                    let nextPhaseEvent = phase.nextPhaseEvent;
                                    if (nextPhaseEvent !== undefined) {

                                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                            let situation = nextPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                                if (condition.code !== undefined) {
                                                    newCondition(key, condition.code);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    function newCondition(key, node) {

                        let condition;
                        let error = ''
                        let value 

                        try {
                            value = eval(node.code);
                        } catch (err) {
                            /*
                                One possible error is that the conditions references a .previous that is undefined. For this
                                reason and others, we will simply set the value to false.
                            */
                            value = false
                            node.error = err.message
                        }

                        condition = {
                            key: key,
                            value: value
                        };

                        conditions.set(condition.key, condition);

                        if (condition.value) {
                            conditionsArrayValues.push(1);
                        } else {
                            conditionsArrayValues.push(0);
                        }
                    }

                }

                if (
                    strategyStage === 'No Stage' &&
                    currentStrategyIndex === -1 
                ) {
                    let minimunBalance
                    let maximunBalance
                    let balance 

                    if (baseAsset === 'BTC') {
                        balance = balanceAssetA
                        minimunBalance = minimunBalanceA
                        maximunBalance = maximunBalanceA
                    } else {
                        balance = balanceAssetB
                        minimunBalance = minimunBalanceB
                        maximunBalance = maximunBalanceB
                    }

                    if (balance > minimunBalance && balance < maximunBalance) {
                        /* Trigger On Conditions */

                        /*
                        Here we need to pick a strategy, or if there is not suitable strategy for the current
                        market conditions, we pass until the next period.
            
                        To pick a new strategy we will evaluate what we call the trigger on. Once we enter
                        into one strategy, we will ignore market conditions for others. However there is also
                        a strategy trigger off which can be hit before taking a position. If hit, we would
                        be outside a strategy again and looking for the condition to enter all over again.
        
                        */

                        for (let j = 0; j < tradingSystem.strategies.length; j++) {

                            let strategy = tradingSystem.strategies[j];

                            let triggerStage = strategy.triggerStage

                            if (triggerStage !== undefined) {

                                if (triggerStage.triggerOn !== undefined) {

                                    for (let k = 0; k < triggerStage.triggerOn.situations.length; k++) {

                                        let situation = triggerStage.triggerOn.situations[k];
                                        let passed = true;

                                        for (let m = 0; m < situation.conditions.length; m++) {

                                            let condition = situation.conditions[m];
                                            let key = j + '-' + 'triggerStage' + '-' + 'triggerOn' + '-' + k + '-' + m;

                                            let value = conditions.get(key).value;

                                            if (value === false) { passed = false; }
                                        }

                                        if (passed) {

                                            strategyStage = 'Trigger Stage';
                                            currentStrategyIndex = j;
                                            currentStrategy.begin = candle.begin;
                                            currentStrategy.beginRate = candle.min;
                                            currentStrategy.endRate = candle.min; // In case the strategy does not get exited
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        tradingSystem.error = "Balance below the minimun. No more strategies will be executed."
                    }
                }

                /* Trigger Off Condition */

                if (strategyStage === 'Trigger Stage') {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];

                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {

                        if (triggerStage.triggerOff !== undefined) {

                            for (let k = 0; k < triggerStage.triggerOff.situations.length; k++) {

                                let situation = triggerStage.triggerOff.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = currentStrategyIndex + '-' + 'triggerStage' + '-' + 'triggerOff' + '-' + k + '-' + m;

                                    let value = conditions.get(key).value;

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    currentStrategy.number = currentStrategyIndex
                                    currentStrategy.end = candle.end;
                                    currentStrategy.endRate = candle.min;
                                    currentStrategy.status = 1;
                                    strategyStage = 'No Stage';
                                    currentStrategyIndex = -1;
                                    break;
                                }
                            }
                        }
                    }
                }

                /* Checking if Stop or Take Profit were hit */

                if (
                    strategyStage === 'Open Stage' ||
                    strategyStage === 'Manage Stage'
                ) {

                    /* Checking what happened since the last execution. We need to know if the Stop Loss
                        or our Take Profit were hit. */

                    /* Stop Loss condition: Here we verify if the Stop Loss was hitted or not. */

                    if ((baseAsset === 'BTC' && candle.max >= stopLoss) || (baseAsset !== 'BTC' && candle.min <= stopLoss)) {

                        if (baseAsset === 'BTC') {
                            balanceAssetA = balanceAssetA + balanceAssetB / stopLoss;
                            balanceAssetB = 0;
                        } else {
                            balanceAssetB = balanceAssetB + balanceAssetA * stopLoss;
                            balanceAssetA = 0;
                        }                        

                        if (currentDay !== undefined) {
                            if (positionInstant < currentDay.valueOf()) {
                                yesterday.balanceAssetA = balanceAssetA;
                                yesterday.balanceAssetB = balanceAssetB;
                            }
                        }

                        marketRate = stopLoss;
                        type = '"Buy@StopLoss"';
                        strategyStage = 'Close Stage';
                        stopLossStage = 'No Stage';
                        takeProfitStage = 'No Stage';
                        currentTrade.end = candle.end;
                        currentTrade.status = 1;
                        currentTrade.exitType = 1;
                        currentTrade.endRate = stopLoss;

                        currentStrategy.number = currentStrategyIndex
                        currentStrategy.end = candle.end;
                        currentStrategy.endRate = candle.min;
                        currentStrategy.status = 1;
                    }

                    /* Take Profit condition: Here we verify if the Take Profit was filled or not. */

                    if ((baseAsset === 'BTC' && candle.min <= takeProfit) || (baseAsset !== 'BTC' && candle.max >= takeProfit)) {

                        if (baseAsset === 'BTC') {
                            balanceAssetA = balanceAssetA + balanceAssetB / takeProfit;
                            balanceAssetB = 0;
                        } else {
                            balanceAssetB = balanceAssetB + balanceAssetA * takeProfit;
                            balanceAssetA = 0;
                        }   

                        if (currentDay !== undefined) {
                            if (positionInstant < currentDay.valueOf()) {
                                yesterday.balanceAssetA = balanceAssetA;
                                yesterday.balanceAssetB = balanceAssetB;

                            }
                        }

                        marketRate = takeProfit;
                        type = '"Buy@TakeProfit"';
                        strategyStage = 'Close Stage';
                        stopLossStage = 'No Stage';
                        takeProfitStage = 'No Stage';
                        currentTrade.end = candle.end;
                        currentTrade.status = 1;    
                        currentTrade.exitType = 2;
                        currentTrade.endRate = takeProfit;

                        currentStrategy.number = currentStrategyIndex
                        currentStrategy.end = candle.end;
                        currentStrategy.endRate = candle.min;
                        currentStrategy.status = 1;
                    }
                }

                /* Take Position Condition */

                if (strategyStage === 'Trigger Stage') {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];

                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {

                        if (triggerStage.takePosition !== undefined) {

                            for (let k = 0; k < triggerStage.takePosition.situations.length; k++) {

                                let situation = triggerStage.takePosition.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = currentStrategyIndex + '-' + 'triggerStage' + '-' + 'takePosition' + '-' + k + '-' + m;

                                    let value = conditions.get(key).value;

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    type = '"Sell"';

                                    strategyStage = 'Open Stage';
                                    stopLossStage = 'Open Stage';
                                    takeProfitStage = 'Open Stage';
                                    stopLossPhase = 1;
                                    takeProfitPhase = 1;
                                    currentTrade.begin = candle.begin;
                                    currentTrade.beginRate = candle.close;
                                    takePositionNow = true
                                    break;
                                }
                            }
                        }
                    }
                }

                /* Stop Loss Management */

                if (
                    strategyStage === 'Open Stage' ||
                    strategyStage === 'Manage Stage'
                ) {

                    checkStopPhases()
                    calculateStopLoss();

                }

                function checkStopPhases() {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];

                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let parentNode 
                    let j = currentStrategyIndex
                    let stageKey
                    let initialDefinitionKey = ''
                    let p

                    if (stopLossStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.stopLoss !== undefined) {
                                parentNode = openStage.initialDefinition
                                initialDefinitionKey = '-' + 'initialDefinition'
                                stageKey = 'openStage'
                                p = stopLossPhase - 1
                            } 
                        }
                    }

                    if (stopLossStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.stopLoss !== undefined) {
                            parentNode = manageStage
                            stageKey = 'manageStage'
                            p = stopLossPhase - 2
                        } 
                    }

                    let phase = parentNode.stopLoss.phases[p];

                    let nextPhaseEvent = phase.nextPhaseEvent;
                    if (nextPhaseEvent !== undefined) {

                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                            let situation = nextPhaseEvent.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                stopLossPhase++;
                                stopLossStage = 'Manage Stage'
                                if (takeProfitPhase > 1) { strategyStage = 'Manage Stage' }
                                return;
                            }
                        }
                    }
                }

                function calculateStopLoss() {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];
                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let phase 
                    let key

                    if (stopLossStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.stopLoss !== undefined) {
                                phase = openStage.initialDefinition.stopLoss.phases[stopLossPhase - 1];
                                key = currentStrategyIndex + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + (stopLossPhase - 1);
                            }
                        }
                    }

                    if (stopLossStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.stopLoss !== undefined) {
                            phase = manageStage.stopLoss.phases[stopLossPhase - 2];
                            key = currentStrategyIndex + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + (stopLossPhase - 2);
                        }
                    }

                    if (phase.formula !== undefined) {
                        stopLoss = formulas.get(key)
                    }
                }

                /* Take Profit Management */

                if (
                    strategyStage === 'Open Stage' ||
                    strategyStage === 'Manage Stage'
                ) {

                    checkTakeProfitPhases();
                    calculateTakeProfit();

                }

                function checkTakeProfitPhases() {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];

                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let parentNode
                    let j = currentStrategyIndex
                    let stageKey
                    let initialDefinitionKey = ''
                    let p

                    if (takeProfitStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.takeProfit !== undefined) {
                                parentNode = openStage.initialDefinition
                                initialDefinitionKey = '-' + 'initialDefinition'
                                stageKey = 'openStage'
                                p = takeProfitPhase - 1
                            }
                        }
                    }

                    if (takeProfitStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.takeProfit !== undefined) {
                            parentNode = manageStage
                            stageKey = 'manageStage'
                            p = takeProfitPhase - 2
                        }
                    }

                    let phase = parentNode.takeProfit.phases[p];

                    let nextPhaseEvent = phase.nextPhaseEvent;
                    if (nextPhaseEvent !== undefined) {

                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                            let situation = nextPhaseEvent.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                takeProfitPhase++;
                                takeProfitStage = 'Manage Stage'
                                if (stopLossPhase > 1) { strategyStage = 'Manage Stage' }
                                return;
                            }
                        }
                    }
                }

                function calculateTakeProfit() {

                    let strategy = tradingSystem.strategies[currentStrategyIndex];
                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let phase
                    let key

                    if (takeProfitStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.takeProfit !== undefined) {
                                phase = openStage.initialDefinition.takeProfit.phases[takeProfitPhase - 1];
                                key = currentStrategyIndex + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + (takeProfitPhase - 1);
                            }
                        }
                    }

                    if (takeProfitStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.takeProfit !== undefined) {
                            phase = manageStage.takeProfit.phases[takeProfitPhase - 2];
                            key = currentStrategyIndex + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + (takeProfitPhase - 2);
                        }
                    }

                    if (phase.formula !== undefined) {
                        takeProfit = formulas.get(key)
                    }
                }

                /* Taking a Position */

                if (
                    takePositionNow === true
                ) {
                    takePositionNow = false

                    /* positionSize default is the whole balance if no size was defined by the user */
                    if (baseAsset === 'BTC') {
                        positionSize = balanceAssetA; 
                    } else {
                        positionSize = balanceAssetB; 
                    }  
                    
                    /* Check if the user defined a position size */
                    let strategy = tradingSystem.strategies[currentStrategyIndex];
                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {
                        if (triggerStage.positionSize !== undefined) {
                            if (triggerStage.positionSize.formula !== undefined) {
                                try {
                                    positionSize = eval(triggerStage.positionSize.formula.code); 
                                } catch (err) {
                                    triggerStage.positionSize.formula.error = err.message
                                }
                                if (isNaN(positionSize)) {
                                    if (baseAsset === 'BTC') {
                                        positionSize = balanceAssetA;
                                    } else {
                                        positionSize = balanceAssetB;
                                    }
                                } else {
                                    if (baseAsset === 'BTC') {
                                        if (positionSize > balanceAssetA) { positionSize = balanceAssetA}
                                    } else {
                                        if (positionSize > balanceAssetB) { positionSize = balanceAssetB}
                                    }  
                                }
                            }
                        }
                    }

                    marketRate = candle.close;

                    calculateStopLoss();
                    calculateTakeProfit();

                    previousBalanceAssetA = balanceAssetA;
                    previousBalanceAssetB = balanceAssetB;

                    lastProfit = 0;
                    lastProfitPercent = 0;

                    if (baseAsset === 'BTC') {
                        balanceAssetB = balanceAssetB + positionSize * positionRate;
                        balanceAssetA = balanceAssetA - positionSize;
                    } else {
                        balanceAssetA = balanceAssetA + positionSize / positionRate;
                        balanceAssetB = balanceAssetB - positionSize;
                    }  

                    positionInstant = candle.end;

                    if (currentDay !== undefined) {
                        if (positionInstant < currentDay.valueOf()) {
                            yesterday.balanceAssetA = balanceAssetA;
                            yesterday.balanceAssetB = balanceAssetB;

                            yesterday.lastProfit = lastProfit;
                            yesterday.lastProfitPercent = lastProfitPercent;
                        }
                    }

                    addRecord();
                    continue;
                }

                /* Closing a Position */

                if (strategyStage === 'Close Stage') {

                    roundtrips++;

                    if (currentDay !== undefined) {
                        if (positionInstant < currentDay.valueOf()) {
                            yesterday.Roundtrips++;
                        }                        
                    }

                    if (baseAsset === 'BTC') {
                        lastProfit = balanceAssetA - previousBalanceAssetA;
                        lastProfitPercent = lastProfit / previousBalanceAssetA * 100;
                        if (isNaN(lastProfitPercent)) { lastProfitPercent = 0; }
                        profit = balanceAssetA - initialBalanceA;
                    } else {
                        lastProfit = balanceAssetB - previousBalanceAssetB;
                        lastProfitPercent = lastProfit / previousBalanceAssetB * 100;
                        if (isNaN(lastProfitPercent)) { lastProfitPercent = 0; }
                        profit = balanceAssetB - initialBalanceB;
                    }  

                    if (currentDay !== undefined) {
                        if (positionInstant < currentDay.valueOf()) {
                            yesterday.lastProfit = lastProfit;
                            yesterday.profit = profit;
                            yesterday.lastProfitPercent = lastProfitPercent;
                        }
                    }

                    currentTrade.lastProfitPercent = lastProfitPercent;
                    currentTrade.stopRate = stopLoss;
                   
                    if (lastProfit > 0) {
                        hits++;

                        if (currentDay !== undefined) {
                            if (positionInstant < currentDay.valueOf()) {
                                yesterday.hits++;
                            }
                        }

                    } else {
                        fails++;

                        if (currentDay !== undefined) {
                            if (positionInstant < currentDay.valueOf()) {
                                yesterday.fails++;
                            }
                        }
                    }

                    if (baseAsset === 'BTC') {
                        ROI = (initialBalanceA + profit) / initialBalanceA - 1;
                        hitRatio = hits / roundtrips;
                        anualizedRateOfReturn = ROI / days * 365;
                    } else {
                        ROI = (initialBalanceB + profit) / initialBalanceB - 1;
                        hitRatio = hits / roundtrips;
                        anualizedRateOfReturn = ROI / days * 365;
                    }  

                    if (currentDay !== undefined) {
                        if (positionInstant < currentDay.valueOf()) {
                            yesterday.ROI = ROI;
                            yesterday.hitRatio = hitRatio;
                            yesterday.anualizedRateOfReturn = anualizedRateOfReturn;
                        }
                    }


                    addRecord();

                    currentStrategyIndex = -1;
                    stopLoss = 0;
                    positionRate = 0;
                    positionSize = 0;
                    positionInstant = undefined;
                    takeProfit = 0;
                    strategyStage = 'No Stage';
                    stopLossStage = 'No Stage';
                    takeProfitStage = 'No Stage';
                    stopLossPhase = 0;
                    takeProfitPhase = 0;
                    continue;

                }

                /* Not a buy or sell condition */

                marketRate = candle.close;
                addRecord();

                function addRecord() {

                    // Since we are going to write the message to a file that the Simulation Executor is going to read, we use the abbreviations.
                    let messageType;
                    let message;
                    let simulationRecord;
                    let orderRecord;

                    messageId++;

                    if (strategyStage === 'Open Stage' || strategyStage === 'Manage Stage') {

                        if (strategyStage === 'Open Stage') {
                            messageType = MESSAGE_TYPE.Order;
                            orderId++;
                        }
                        if (strategyStage === 'Manage Stage') {
                            messageType = MESSAGE_TYPE.OrderUpdate;
                        }

                        orderRecord = createMessage(
                        messageId,
                        MESSAGE_ENTITY.SimulationEngine,
                        MESSAGE_ENTITY.SimulationExecutor,
                        messageType,
                        (new Date()).valueOf(),
                        orderId.toString(),
                        ORDER_CREATOR.SimulationEngine,
                        (new Date()).valueOf(),
                        ORDER_OWNER.User,
                        global.EXCHANGE_NAME,
                        "BTC_USDT",
                        0,
                        ORDER_TYPE.Limit,
                        marketRate,
                        stopLoss,
                        takeProfit,
                        ORDER_DIRECTION.Sell,
                        -1,
                        ORDER_STATUS.Signaled,
                        0,
                        "")

                    }
                    else {

                        orderRecord = createMessage(
                        messageId,
                        MESSAGE_ENTITY.SimulationEngine,
                        MESSAGE_ENTITY.SimulationExecutor,
                        MESSAGE_TYPE.HeartBeat,
                        (new Date()).valueOf(),
                        "",
                        "",
                        0,
                        "",
                        "",
                        "",
                        0,
                        "",
                        0,
                        0,
                        0,
                        "",
                        0,
                        "",
                        0,
                        "")
                    }

                    let strategyStageNumber 
                    switch (strategyStage) {
                        case 'No Stage': {
                            strategyStageNumber = 0
                            break
                        }
                        case 'Trigger Stage': {
                            strategyStageNumber = 1
                            break
                        }
                        case 'Open Stage': {
                            strategyStageNumber = 2
                            break
                        }
                        case 'Manage Stage': {
                            strategyStageNumber = 3
                            break
                        }
                        case 'Close Stage': {
                            strategyStageNumber = 4
                            break
                        }
                    }

                    simulationRecord = {
                        begin: candle.begin,
                        end: candle.end,
                        type: type,
                        marketRate: marketRate,
                        amount: 1,
                        balanceA: balanceAssetA,
                        balanceB: balanceAssetB,
                        profit: profit,
                        lastProfit: lastProfit,
                        stopLoss: stopLoss,
                        roundtrips: roundtrips,
                        hits: hits,
                        fails: fails,
                        hitRatio: hitRatio,
                        ROI: ROI,
                        periods: periods,
                        days: days,
                        anualizedRateOfReturn: anualizedRateOfReturn,
                        positionRate: positionRate,
                        lastProfitPercent: lastProfitPercent,
                        strategy: currentStrategyIndex,
                        strategyStageNumber: strategyStageNumber,
                        takeProfit: takeProfit,
                        stopLossPhase: stopLossPhase,
                        takeProfitPhase: takeProfitPhase,
                        orderRecord: orderRecord,
                        positionSize: positionSize,
                        initialBalanceA: initialBalanceA,
                        minimunBalanceA: minimunBalanceA,
                        maximunBalanceA: maximunBalanceA,
                        initialBalanceB: initialBalanceB,
                        minimunBalanceB: minimunBalanceB,
                        maximunBalanceB: maximunBalanceB
                    }

                    recordsArray.push(simulationRecord);

                    type = '""';

                    /* Prepare the information for the Conditions File */

                    conditionsArrayRecord.push(currentStrategyIndex);
                    conditionsArrayRecord.push(strategyStageNumber);
                    conditionsArrayRecord.push(stopLossPhase);
                    conditionsArrayRecord.push(takeProfitPhase);
                    conditionsArrayRecord.push(conditionsArrayValues);
                    conditionsArrayRecord.push(formulasErrors);
                    conditionsArrayRecord.push(formulasValues);

                    conditionsArray.push(conditionsArrayRecord);

                    /* Prepare the information for the Strategies File*/

                    if (
                        (currentStrategy.begin !== 0 && currentStrategy.end !== 0) ||
                        (currentStrategy.begin !== 0 && i === candles.length - 1 && lastCandle.end !== lastInstantOfTheDay)
                    ) {

                        strategiesArray.push(currentStrategy);

                        currentStrategy = {
                            begin: 0,
                            end: 0,
                            status: 0,
                            number: 0,
                            beginRate: 0,
                            endRate: 0
                        }
                    }

                    /* Prepare the information for the Trades File */

                    if (
                        (currentTrade.begin !== 0 && currentTrade.end !== 0) ||
                        (currentTrade.begin !== 0 && i === candles.length - 1 && lastCandle.end !== lastInstantOfTheDay)
                    ) {

                        currentTrade.profit = lastProfit;

                        tradesArray.push(currentTrade);

                        currentTrade = {
                            begin: 0,
                            end: 0,
                            status: 0,
                            lastProfitPercent: 0,
                            exitType: 0,
                            beginRate: 0,
                            endRate: 0
                        }
                    }
                }
            }

            /*
            Before returning we need to see if we have to record some of our counters at the interExecutionMemory.
            To do that, the condition to be met is that this execution must include all candles of the currentDay.
            */

            if (currentDay !== undefined) {

                if (lastCandle.end === lastInstantOfTheDay) {

                    interExecutionMemory.balanceAssetA = yesterday.balanceAssetA;
                    interExecutionMemory.balanceAssetB = yesterday.balanceAssetB;
                    interExecutionMemory.lastProfit = yesterday.lastProfit;
                    interExecutionMemory.profit = yesterday.profit;
                    interExecutionMemory.lastProfitPercent = yesterday.lastProfitPercent;

                    interExecutionMemory.roundtrips = interExecutionMemory.roundtrips + yesterday.Roundtrips;
                    interExecutionMemory.fails = interExecutionMemory.fails + yesterday.fails;
                    interExecutionMemory.hits = interExecutionMemory.hits + yesterday.hits;
                    interExecutionMemory.periods = interExecutionMemory.periods + yesterday.Periods;

                    interExecutionMemory.messageId = interExecutionMemory.messageId + yesterday.messageId;
                    interExecutionMemory.orderId = interExecutionMemory.orderId + yesterday.orderId;

                    interExecutionMemory.hitRatio = yesterday.hitRatio;
                    interExecutionMemory.ROI = yesterday.ROI;
                    interExecutionMemory.anualizedRateOfReturn = yesterday.anualizedRateOfReturn;
                }
            }

            callback(tradingSystem);

            function getElement(pArray, begin, end) {

                let element;

                for (let i = 0; i < pArray.length; i++) {

                    element = pArray[i];

                    if (begin >= element.begin && end <= element.end) {
                        return element
                    }
                }

                element = {
                    direction: 'unknown',
                    slope: 'unknown'
                };
                return element;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] runSimulation -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildLRC(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildLRC -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let LRC = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    _15: dataFile[i][2],
                    _30: dataFile[i][3],
                    _60: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous._15 > LRC._15) { LRC.direction15 = 'down'; }
                    if (previous._15 < LRC._15) { LRC.direction15 = 'up'; }
                    if (previous._15 === LRC._15) { LRC.direction15 = 'side'; }

                    if (previous._30 > LRC._30) { LRC.direction30 = 'down'; }
                    if (previous._30 < LRC._30) { LRC.direction30 = 'up'; }
                    if (previous._30 === LRC._30) { LRC.direction30 = 'side'; }

                    if (previous._60 > LRC._60) { LRC.direction60 = 'down'; }
                    if (previous._60 < LRC._60) { LRC.direction60 = 'up'; }
                    if (previous._60 === LRC._60) { LRC.direction60 = 'side'; }

                }

                LRC.previous = previous;

                LRCMap.set(LRC.begin, LRC);

                previous = LRC;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildLRC -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildPercentageBandwidthMap(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildPercentageBandwidthMap -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let percentageBandwidth = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    value: dataFile[i][2],
                    movingAverage: dataFile[i][3],
                    bandwidth: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous.movingAverage > percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'down'; }
                    if (previous.movingAverage < percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'up'; }
                    if (previous.movingAverage === percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'side'; }

                }

                percentageBandwidth.previous = previous;

                percentageBandwidthMap.set(percentageBandwidth.begin, percentageBandwidth);

                previous = percentageBandwidth;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildPercentageBandwidthMap -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerBandsMap(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerBandsMap -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerBand = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    movingAverage: dataFile[i][2],
                    standardDeviation: dataFile[i][3],
                    deviation: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous.movingAverage > bollingerBand.movingAverage) { bollingerBand.direction = 'down'; }
                    if (previous.movingAverage < bollingerBand.movingAverage) { bollingerBand.direction = 'up'; }
                    if (previous.movingAverage === bollingerBand.movingAverage) { bollingerBand.direction = 'side'; }

                }

                bollingerBand.previous = previous;

                bollingerBandsMap.set(bollingerBand.begin, bollingerBand);

                previous = bollingerBand;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerBandsMap -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerChannelsArray(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerChannelsArray -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerChannel = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    direction: dataFile[i][2],
                    period: dataFile[i][3],
                    firstMovingAverage: dataFile[i][4],
                    lastMovingAverage: dataFile[i][5],
                    firstDeviation: dataFile[i][6],
                    lastDeviation: dataFile[i][7]
                };

                bollingerChannel.previous = previous;

                bollingerChannelsArray.push(bollingerChannel);

                previous = bollingerChannel;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerChannelsArray -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerSubChannelsArray(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerSubChannelsArray -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerSubChannel = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    direction: dataFile[i][2],
                    slope: dataFile[i][3],
                    period: dataFile[i][4],
                    firstMovingAverage: dataFile[i][5],
                    lastMovingAverage: dataFile[i][6],
                    firstDeviation: dataFile[i][7],
                    lastDeviation: dataFile[i][8]
                };

                bollingerSubChannel.previous = previous;

                bollingerSubChannelsArray.push(bollingerSubChannel);

                previous = bollingerSubChannel;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerSubChannelsArray -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildCandles(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildCandles -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let candle = {
                    open: undefined,
                    close: undefined,
                    min: 10000000000000,
                    max: 0,
                    begin: undefined,
                    end: undefined,
                    direction: undefined
                };

                candle.min = dataFile[i][0];
                candle.max = dataFile[i][1];

                candle.open = dataFile[i][2];
                candle.close = dataFile[i][3];

                candle.begin = dataFile[i][4];
                candle.end = dataFile[i][5];

                if (candle.open > candle.close) { candle.direction = 'down'; }
                if (candle.open < candle.close) { candle.direction = 'up'; }
                if (candle.open === candle.close) { candle.direction = 'side'; }

                candle.previous = previous;

                candles.push(candle);

                previous = candle;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildCandles -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }
};



