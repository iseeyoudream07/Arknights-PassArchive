"""Generate a small, dependency-free Xcode project for the native starter."""
import hashlib
import shutil
from pathlib import Path
root = Path(__file__).resolve().parent.parent
base = root / 'ios'
project = base / 'PassArchive.xcodeproj'
project.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root / 'data/catalog.json', base / 'PassArchive/catalog.json')
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
files = ['Models.swift','ArchiveStore.swift','PassArchiveApp.swift','ContentView.swift','catalog.json']
objects=[]
def obj(name,value): objects.append(f'{uid(name)} = {value};')
for f in files:
    kind='sourcecode.swift' if f.endswith('.swift') else 'text.json'
    obj(f+'-ref',f'{{isa = PBXFileReference; lastKnownFileType = {kind}; path = "PassArchive/{f}"; sourceTree = "<group>";}}')
    obj(f+'-build',f'{{isa = PBXBuildFile; fileRef = {uid(f+"-ref")};}}')
obj('product','{isa=PBXFileReference; explicitFileType=wrapper.application; path=PassArchive.app; sourceTree=BUILT_PRODUCTS_DIR;}')
obj('products','{isa=PBXGroup; children=('+uid('product')+',); name=Products; sourceTree="<group>";}')
obj('main','{isa=PBXGroup; children=('+','.join(uid(f+'-ref') for f in files)+','+uid('products')+',); sourceTree="<group>";}')
obj('sources','{isa=PBXSourcesBuildPhase; buildActionMask=2147483647; files=('+','.join(uid(f+'-build') for f in files if f.endswith('.swift'))+',); runOnlyForDeploymentPostprocessing=0;}')
obj('resources','{isa=PBXResourcesBuildPhase; buildActionMask=2147483647; files=('+uid('catalog.json-build')+',); runOnlyForDeploymentPostprocessing=0;}')
obj('frameworks','{isa=PBXFrameworksBuildPhase; buildActionMask=2147483647; files=(); runOnlyForDeploymentPostprocessing=0;}')
common='SDKROOT=iphoneos; IPHONEOS_DEPLOYMENT_TARGET=17.0; SWIFT_VERSION=5.0; CLANG_ENABLE_MODULES=YES;'
target='PRODUCT_BUNDLE_IDENTIFIER=win.yukkuri.arknights.passarchive; PRODUCT_NAME="$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE=YES; INFOPLIST_KEY_CFBundleDisplayName="通行认证档案"; INFOPLIST_KEY_UILaunchScreen_Generation=YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation=YES; TARGETED_DEVICE_FAMILY="1,2"; MARKETING_VERSION=0.1.0; CURRENT_PROJECT_VERSION=1; CODE_SIGN_STYLE=Automatic;'
for owner in ['project','target']:
    for mode in ['Debug','Release']:
        extra='SWIFT_OPTIMIZATION_LEVEL="-Onone"; DEBUG_INFORMATION_FORMAT=dwarf;' if mode=='Debug' else 'SWIFT_OPTIMIZATION_LEVEL="-O";'
        obj(owner+mode,'{isa=XCBuildConfiguration; buildSettings={'+common+(target if owner=='target' else '')+extra+'}; name='+mode+';}')
    obj(owner+'configs','{isa=XCConfigurationList; buildConfigurations=('+uid(owner+'Debug')+','+uid(owner+'Release')+',); defaultConfigurationIsVisible=0; defaultConfigurationName=Release;}')
obj('target','{isa=PBXNativeTarget; buildConfigurationList='+uid('targetconfigs')+'; buildPhases=('+uid('sources')+','+uid('frameworks')+','+uid('resources')+',); buildRules=(); dependencies=(); name=PassArchive; productName=PassArchive; productReference='+uid('product')+'; productType="com.apple.product-type.application";}')
obj('project','{isa=PBXProject; attributes={BuildIndependentTargetsInParallel=YES; LastUpgradeCheck=2700;}; buildConfigurationList='+uid('projectconfigs')+'; compatibilityVersion="Xcode 14.0"; developmentRegion=zh-Hans; knownRegions=(en,Base,zh-Hans); mainGroup='+uid('main')+'; productRefGroup='+uid('products')+'; projectDirPath=""; projectRoot=""; targets=('+uid('target')+',);}')
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion=1; classes={}; objectVersion=56; objects={\n'+'\n'.join(objects)+'\n}; rootObject='+uid('project')+';}\n')
print(project)
