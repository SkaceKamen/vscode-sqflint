export const normalizeTemplateParams = (template: string, parameters: Record<string, string>) => {
    switch (template) {
    case 'Function':
    case 'Command':{
        Object.entries({
            1: 'game1',
            2: 'version1',
            3: 'descr',
            4: 's1',
            5: 'r1',
            6: 'seealso'
        }).forEach(([numeric, named]) => {
            if (parameters[numeric] !== undefined) {
                if (parameters[named] !== undefined) {
                    // This seems to be unneccessary:
                    // console.warn(`${named} seems to be already defined, cannot be overriden by numeric`)
                } else {
                    parameters[named] = parameters[numeric]
                }
            }
        })

        return parameters
    }
    default:
        return parameters
    }
}
