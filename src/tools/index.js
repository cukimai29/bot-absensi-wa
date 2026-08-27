const { getScheduleTool, addScheduleTool, deleteScheduleTool } = require('./scheduleTools');
const { getTasksTool, addTaskTool, deleteTaskTool } = require('./taskTools');
const { checkKasTool, mapKasContactTool } = require('./kasTools');
const { checkEtholTool } = require('./etholTools');
const { getCurrentTimeTool } = require('./generalTools');

/**
 * Central Tool Registry untuk Vercel AI SDK Gemini Agent
 */
const allTools = {
    getSchedule: getScheduleTool,
    addSchedule: addScheduleTool,
    deleteSchedule: deleteScheduleTool,
    getTasks: getTasksTool,
    addTask: addTaskTool,
    deleteTask: deleteTaskTool,
    checkKas: checkKasTool,
    mapKasContact: mapKasContactTool,
    checkEthol: checkEtholTool,
    getCurrentTime: getCurrentTimeTool
};

module.exports = { allTools };
