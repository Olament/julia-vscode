import * as path from 'path'
import * as vscode from 'vscode'
import * as telemetry from '../telemetry'
import { registerCommand } from '../utils'


const c_juliaPlotPanelActiveContextKey = 'jlplotpaneFocus'
const g_plots: Array<string> = new Array<string>()
let g_currentPlotIndex: number = 0
let g_plotPanel: vscode.WebviewPanel | undefined = undefined
let g_context: vscode.ExtensionContext = null
let g_plotProvider: PlotViewProvider = null
let g_screenShotScript: string = ""

export function activate(context: vscode.ExtensionContext) {
    g_context = context

    g_plotProvider = new PlotViewProvider(context)

    context.subscriptions.push(registerCommand('language-julia.show-plotpane', showPlotPane))

    context.subscriptions.push(registerCommand('language-julia.plotpane-previous', plotPanePrev))

    context.subscriptions.push(registerCommand('language-julia.plotpane-next', plotPaneNext))

    context.subscriptions.push(registerCommand('language-julia.plotpane-first', plotPaneFirst))

    context.subscriptions.push(registerCommand('language-julia.plotpane-last', plotPaneLast))

    context.subscriptions.push(registerCommand('language-julia.plotpane-delete', plotPaneDel))

    context.subscriptions.push(registerCommand('language-julia.plotpane-delete-all', plotPaneDelAll))

    context.subscriptions.push(registerCommand('language-julia.show-plot-navigator', g_plotProvider.showPlotNavigator))

    vscode.window.registerWebviewViewProvider('julia-plot-navigator', g_plotProvider)
}

interface Plot {
    thumbnail_type: string,
    thumbnail_data: string
}

class PlotViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView
    private plotsInfo?: Array<Plot>
    private context: vscode.ExtensionContext

    constructor(context: vscode.ExtensionContext) {
        this.plotsInfo = []
        this.context = context
    }

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext) {
        this.view = view

        view.webview.options = {
            enableScripts: true,
            enableCommandUris: true
        }

        view.webview.onDidReceiveMessage(msg => {
            // msg.type could be used to determine messages
            switch (msg.type) {
                case "toPlot": // switch current plot to plot at index (msg.value)
                    if (msg.value >= 0 && msg.value <= g_plots.length - 1) {
                        g_currentPlotIndex = msg.value
                        updatePlotPane()
                    }
                    break
                default:
                    console.error(`Unknown message type from WebView: ${msg.type}, value: ${msg.value}`)
            }

        })

        this.reloadPlotPane()
    }

    getWebviewHTML(innerHTML: string) {
        const extensionPath = this.context.extensionPath
        const plotterStylesheet = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'plotter', 'plotter.css')))
        const plotterJavaScript = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'src', 'interactive', 'plots', 'panel_webview.js')))

        return `<html lang="en" class='theme--plotter'>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Julia Plots</title>
                <link href=${plotterStylesheet} rel="stylesheet" type="text/css">
            </head>
            <body style="padding: 10px 1em 1em 1em">
                ${innerHTML}
                <script src=${plotterJavaScript}></script>
            </body>
        </html>`
    }

    showPlotNavigator = async () => {
        // this forces the webview to be resolved:
        await vscode.commands.executeCommand('julia-plot-navigator.focus')
        // should always be true, but better safe than sorry
        if (this.view) {
            this.view.show?.(true)
        }
    }

    setPlotsInfo(set_func) {
        this.plotsInfo = set_func(this.plotsInfo)
        this.reloadPlotPane()
    }

    getPlotsInfo() {
        return this.plotsInfo
    }

    plotToThumbnail(plot: Plot, index: number) {
        let thumbnailHTML: string
        switch (plot.thumbnail_type) {
            case "image":
                thumbnailHTML = `<div class="thumbnail" onclick="toPlot(${index})">
                    <img src="${plot.thumbnail_data}" alt="Plot ${index + 1}" />
                </div>`
                break
            default:
            case "text": // This is a fallback which shows the index of the plot
                thumbnailHTML = `<p class="thumbnail" onclick="toPlot(${index})">Plot ${index + 1} </p>`
                break
        }
        return thumbnailHTML
    }

    reloadPlotPane() {
        if (!this.view) {
            return
        }

        let innerHTML: string
        if (this.plotsInfo.length > 0) {
            innerHTML = `<div>
            ${this.plotsInfo.map(this.plotToThumbnail).join("\n")}
        </div>`
        } else {
            innerHTML = `<p>Use Julia to plot and your plots will appear here.</p>`
        }

        this.setHTML(this.getWebviewHTML(innerHTML))
    }

    postMessageToWebview(message: any) {
        if (this.view) {
            this.view.webview.postMessage(message)
        }
    }

    setHTML(html: string) {
        if (this.view) {
            this.view.webview.html = html
        }
    }
}

function getPlotPaneContent() {
    if (g_plots.length === 0) {
        return `<html>${g_screenShotScript}</html>`
    }
    else {
        return g_plots[g_currentPlotIndex] + g_screenShotScript
    }
}

function plotPanelOnMessage(message) {
    console.log("Message in plot panel: ", message)
    if (message.type == "thumbnail") {
        let thumbnailData = message.value
        g_plotProvider.setPlotsInfo(plotsInfo => {
            plotsInfo[g_currentPlotIndex] = {
                "thumbnail_type": "image",
                "thumbnail_data": thumbnailData
            }
            return plotsInfo
        })
    }
}

export function showPlotPane() {
    telemetry.traceEvent('command-showplotpane')

    vscode.commands.executeCommand('language-julia.show-plot-navigator')

    const plotTitle = g_plots.length > 0 ? `Julia Plots (${g_currentPlotIndex + 1}/${g_plots.length})` : 'Julia Plots (0/0)'
    if (!g_plotPanel) {
        // Otherwise, create a new panel
        g_plotPanel = vscode.window.createWebviewPanel(
            'jlplotpane',
            plotTitle,
            {
                preserveFocus: true,
                viewColumn: g_context.globalState.get('juliaPlotPanelViewColumn', vscode.ViewColumn.Beside)
            },
            {
                enableScripts: true
            }
        )
        g_plotPanel.onDidChangeViewState(({ webviewPanel }) => {
            g_context.globalState.update('juliaPlotPanelViewColumn', webviewPanel.viewColumn)
        })
        g_plotPanel.webview.html = getPlotPaneContent()
        vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, true)

        // Reset when the current panel is closed
        g_plotPanel.onDidDispose(() => {
            g_plotPanel = undefined
            vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, false)
        }, null, g_context.subscriptions)

        g_plotPanel.onDidChangeViewState(({ webviewPanel }) => {
            vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, webviewPanel.active)
        }, null, g_context.subscriptions)

        g_plotPanel.webview.onDidReceiveMessage(plotPanelOnMessage)
    }
    else {
        g_plotPanel.title = plotTitle
        g_plotPanel.webview.html = getPlotPaneContent()
    }
}

function updatePlotPane() {
    showPlotPane()
}

export function plotPanePrev() {
    telemetry.traceEvent('command-plotpaneprevious')

    if (g_currentPlotIndex > 0) {
        g_currentPlotIndex = g_currentPlotIndex - 1
        updatePlotPane()
    }
}

export function plotPaneNext() {
    telemetry.traceEvent('command-plotpanenext')

    if (g_currentPlotIndex < g_plots.length - 1) {
        g_currentPlotIndex = g_currentPlotIndex + 1
        updatePlotPane()
    }
}

export function plotPaneFirst() {
    telemetry.traceEvent('command-plotpanefirst')

    if (g_plots.length > 0) {
        g_currentPlotIndex = 0
        updatePlotPane()
    }
}

export function plotPaneLast() {
    telemetry.traceEvent('command-plotpanelast')
    if (g_plots.length > 0) {
        g_currentPlotIndex = g_plots.length - 1
        updatePlotPane()
    }
}

export function plotPaneDel() {
    telemetry.traceEvent('command-plotpanedelete')
    if (g_plots.length > 0) {
        g_plotProvider.setPlotsInfo(plotsInfo => {
            plotsInfo.splice(g_currentPlotIndex, 1)
            return plotsInfo
        })
        g_plots.splice(g_currentPlotIndex, 1)
        if (g_currentPlotIndex > g_plots.length - 1) {
            g_currentPlotIndex = g_plots.length - 1
        }
        updatePlotPane()
    }
}

export function plotPaneDelAll() {
    telemetry.traceEvent('command-plotpanedeleteall')
    if (g_plots.length > 0) {
        g_plotProvider.setPlotsInfo(plotsInfo => {
            plotsInfo.splice(0, plotsInfo.length)
            return plotsInfo
        })
        g_plots.splice(0, g_plots.length)
        g_currentPlotIndex = 0
        updatePlotPane()
    }
}

// wrap a source string with an <img> tag that shows the content
// scaled to fit the plot pane unless the plot pane is bigger than the image
function wrap_imagelike(srcstring: string) {
    const html = `
    <html style="padding:0;margin:0;">
        <body style="padding:0;margin:0;">
            <div style="width: 100%; height: 100vh;">
                <img style="display:block; height: 100%; width: 100%; object-fit: scale-down; object-position: 0 0;" src="${srcstring}">
            </div>
        </body>
    </html>`
    return html
}

export function displayPlot(params: { kind: string, data: string }) {
    const kind = params.kind
    const payload = params.data

    if (kind !== 'application/vnd.dataresource+json') {
        showPlotPane()
        // We need to show the pane before accessing the webview to avoid "undefined" issue in webview.
        g_screenShotScript = `<script src="${g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'html2canvas', 'html2canvas.min.js')))}"></script>
        <script src="${g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'src', 'interactive', 'plots', 'main_plot_webview.js')))}"></script>`

        // We display a text thumbnail first just in case that JavaScript errors in the webview or did not successfully send out message and corrupt thumbnail indices.
        g_plotProvider.setPlotsInfo(plotsInfo => {
            plotsInfo.push({
                "thumbnail_type": "text",
                "thumbnail_data": null
            })
            return plotsInfo
        })
    }

    if (kind === 'image/svg+xml') {
        const has_xmlns_attribute = payload.includes('xmlns=')
        let plotPaneContent: string
        if (has_xmlns_attribute) {
            // the xmlns attribute has to be present for data:image/svg+xml to work (https://stackoverflow.com/questions/18467982)
            // encodeURIComponent is needed to replace all special characters from the SVG string
            // which could break the HTML
            plotPaneContent = wrap_imagelike(`data:image/svg+xml,${encodeURIComponent(payload)}`)
        } else {
            // otherwise we just show the svg directly as it's not straightforward to scale it
            // correctly if it's not in an img tag
            plotPaneContent = payload
        }

        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'image/png') {
        const plotPaneContent = wrap_imagelike(`data:image/png;base64,${payload}`)
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'image/gif') {
        const plotPaneContent = wrap_imagelike(`data:image/gif;base64,${payload}`)
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'juliavscode/html') {
        g_currentPlotIndex = g_plots.push(payload) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v2+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-2', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v3+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-3', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v4+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-4', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v3+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v4+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-4', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v5+json') {
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.plotly.v1+json') {
        const uriPlotly = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'plotly', 'plotly.min.js')))
        const plotPaneContent = `
        <html>
        <head>
            <script src="${uriPlotly}"></script>
        </head>
        <body>
            <div id="plotdiv" style="position: absolute; width: 100%; height: 100vh; top: 0; left: 0;"></div>
        </body>
        <script type="text/javascript">
            function onResize () {
                const update = {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
                Plotly.relayout('plotdiv', update)
            }
            const spec = ${payload};
            Plotly.newPlot('plotdiv', spec.data, spec.layout);
            if (!(spec.layout.width || spec.layout.height)) {
                onResize()
                window.addEventListener('resize', onResize);
            }
        </script>
        </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.dataresource+json') {
        const grid_panel = vscode.window.createWebviewPanel('jlgrid', 'Julia Table', { preserveFocus: true, viewColumn: vscode.ViewColumn.Active }, { enableScripts: true, retainContextWhenHidden: true })

        const uriAgGrid = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-grid-community.min.noStyle.js')))
        const uriAgGridCSS = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-grid.css')))
        const uriAgGridTheme = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-theme-balham.css')))
        const grid_content = `
            <html>
                <head>
                    <script src="${uriAgGrid}"></script>
                    <style> html, body { margin: 0; padding: 0; height: 100%; } </style>
                    <link rel="stylesheet" href="${uriAgGridCSS}">
                    <link rel="stylesheet" href="${uriAgGridTheme}">
                </head>
            <body>
                <div id="myGrid" style="height: 100%; width: 100%;" class="ag-theme-balham"></div>
            </body>
            <script type="text/javascript">
                var payload = ${payload};
                var gridOptions = {
                    onGridReady: event => event.api.sizeColumnsToFit(),
                    onGridSizeChanged: event => event.api.sizeColumnsToFit(),
                    defaultColDef: {
                        resizable: true,
                        filter: true,
                        sortable: true
                    },
                    columnDefs: payload.schema.fields.map(function(x) {
                        if (x.type == "number" || x.type == "integer") {
                            return {
                                field: x.name,
                                type: "numericColumn",
                                filter: "agNumberColumnFilter"
                            };
                        } else if (x.type == "date") {
                            return {
                                field: x.name,
                                filter: "agDateColumnFilter"
                            };
                        } else {
                            return {field: x.name};
                        };
                    }),
                rowData: payload.data
                };
                var eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        </html>
        `

        grid_panel.webview.html = grid_content
    }
    else {
        throw new Error()
    }
}
