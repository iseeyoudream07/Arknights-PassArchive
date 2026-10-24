# 生成 iOS 的 Xcode 工程文件，引用 Swift 源码与随包目录数据。
# 该脚本执行时会重写 project.pbxproj；只编辑 Python/Web 时无需运行。

"""Generate the dependency-free native app project and its shared scheme."""
import hashlib
import shutil
from pathlib import Path
root = Path(__file__).resolve().parent.parent
base = root / 'ios'
project = base / 'PassArchive.xcodeproj'
project.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root / 'data/catalog.json', base / 'PassArchive/catalog.json')
# 根据名称生成确定性的 Xcode 对象 ID，减少重复生成时的无意义差异。
def uid(s): return hashlib.sha1(s.encode()).hexdigest()[:24].upper()
files = [p.name for p in sorted((base / 'PassArchive').glob('*.swift'))] + ['catalog.json']
objects=[]
# 登记一项 Xcode 工程对象，供后续统一写出工程文件。
def obj(name,value): objects.append(f'{uid(name)} = {value};')
for f in files:
    kind='sourcecode.swift' if f.endswith('.swift') else 'text.json'
    obj(f+'-ref',f'{{isa = PBXFileReference; lastKnownFileType = {kind}; path = "PassArchive/{f}"; sourceTree = "<group>";}}')
    obj(f+'-build',f'{{isa = PBXBuildFile; fileRef = {uid(f+"-ref")};}}')
obj('product','{isa=PBXFileReference; explicitFileType=wrapper.application; path=PassArchive.app; sourceTree=BUILT_PRODUCTS_DIR;}')
obj('uitest-ref','{isa=PBXFileReference; lastKnownFileType=sourcecode.swift; path="UITests/PassArchiveUITests.swift"; sourceTree="<group>";}')
obj('uitest-build','{isa=PBXBuildFile; fileRef='+uid('uitest-ref')+';}')
obj('uitest-product','{isa=PBXFileReference; explicitFileType=wrapper.cfbundle; path=PassArchiveUITests.xctest; sourceTree=BUILT_PRODUCTS_DIR;}')
obj('products','{isa=PBXGroup; children=('+uid('product')+','+uid('uitest-product')+',); name=Products; sourceTree="<group>";}')
obj('main','{isa=PBXGroup; children=('+','.join(uid(f+'-ref') for f in files)+','+uid('uitest-ref')+','+uid('products')+',); sourceTree="<group>";}')
obj('sources','{isa=PBXSourcesBuildPhase; buildActionMask=2147483647; files=('+','.join(uid(f+'-build') for f in files if f.endswith('.swift'))+',); runOnlyForDeploymentPostprocessing=0;}')
obj('resources','{isa=PBXResourcesBuildPhase; buildActionMask=2147483647; files=('+uid('catalog.json-build')+',); runOnlyForDeploymentPostprocessing=0;}')
obj('frameworks','{isa=PBXFrameworksBuildPhase; buildActionMask=2147483647; files=(); runOnlyForDeploymentPostprocessing=0;}')
common='SDKROOT=iphoneos; IPHONEOS_DEPLOYMENT_TARGET=17.0; SWIFT_VERSION=5.0; CLANG_ENABLE_MODULES=YES;'
target='PRODUCT_BUNDLE_IDENTIFIER=win.yukkuri.arknights.passarchive; PRODUCT_NAME="$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE=YES; INFOPLIST_KEY_CFBundleDisplayName="通行认证档案"; INFOPLIST_KEY_UILaunchScreen_Generation=YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation=YES; TARGETED_DEVICE_FAMILY="1,2"; MARKETING_VERSION=0.2.0; CURRENT_PROJECT_VERSION=2; CODE_SIGN_STYLE=Automatic;'
for owner in ['project','target']:
    for mode in ['Debug','Release']:
        extra='SWIFT_OPTIMIZATION_LEVEL="-Onone"; DEBUG_INFORMATION_FORMAT=dwarf; SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG;' if mode=='Debug' else 'SWIFT_OPTIMIZATION_LEVEL="-O";'
        obj(owner+mode,'{isa=XCBuildConfiguration; buildSettings={'+common+(target if owner=='target' else '')+extra+'}; name='+mode+';}')
    obj(owner+'configs','{isa=XCConfigurationList; buildConfigurations=('+uid(owner+'Debug')+','+uid(owner+'Release')+',); defaultConfigurationIsVisible=0; defaultConfigurationName=Release;}')
obj('target','{isa=PBXNativeTarget; buildConfigurationList='+uid('targetconfigs')+'; buildPhases=('+uid('sources')+','+uid('frameworks')+','+uid('resources')+',); buildRules=(); dependencies=(); name=PassArchive; productName=PassArchive; productReference='+uid('product')+'; productType="com.apple.product-type.application";}')
obj('uitest-sources','{isa=PBXSourcesBuildPhase; buildActionMask=2147483647; files=('+uid('uitest-build')+',); runOnlyForDeploymentPostprocessing=0;}')
obj('uitest-proxy','{isa=PBXContainerItemProxy; containerPortal='+uid('project')+'; proxyType=1; remoteGlobalIDString='+uid('target')+'; remoteInfo=PassArchive;}')
obj('uitest-dependency','{isa=PBXTargetDependency; target='+uid('target')+'; targetProxy='+uid('uitest-proxy')+';}')
for mode in ['Debug', 'Release']:
    obj('uitest'+mode,'{isa=XCBuildConfiguration; buildSettings={'+common+'PRODUCT_BUNDLE_IDENTIFIER=win.yukkuri.arknights.passarchive.uitests; PRODUCT_NAME="$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE=YES; TEST_TARGET_NAME=PassArchive; TARGETED_DEVICE_FAMILY="1,2"; CODE_SIGN_STYLE=Automatic;}; name='+mode+';}')
obj('uitest-configs','{isa=XCConfigurationList; buildConfigurations=('+uid('uitestDebug')+','+uid('uitestRelease')+',); defaultConfigurationIsVisible=0; defaultConfigurationName=Debug;}')
obj('uitest-target','{isa=PBXNativeTarget; buildConfigurationList='+uid('uitest-configs')+'; buildPhases=('+uid('uitest-sources')+',); buildRules=(); dependencies=('+uid('uitest-dependency')+',); name=PassArchiveUITests; productName=PassArchiveUITests; productReference='+uid('uitest-product')+'; productType="com.apple.product-type.bundle.ui-testing";}')
obj('project','{isa=PBXProject; attributes={BuildIndependentTargetsInParallel=YES; LastUpgradeCheck=2700;}; buildConfigurationList='+uid('projectconfigs')+'; compatibilityVersion="Xcode 14.0"; developmentRegion=zh-Hans; knownRegions=(en,Base,zh-Hans); mainGroup='+uid('main')+'; productRefGroup='+uid('products')+'; projectDirPath=""; projectRoot=""; targets=('+uid('target')+','+uid('uitest-target')+',);}')
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion=1; classes={}; objectVersion=56; objects={\n'+'\n'.join(objects)+'\n}; rootObject='+uid('project')+';}\n')
scheme_dir = project / 'xcshareddata' / 'xcschemes'
scheme_dir.mkdir(parents=True, exist_ok=True)
(scheme_dir / 'PassArchive.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="PassArchive.app" BlueprintName="PassArchive" ReferencedContainer="container:PassArchive.xcodeproj"/>
    </BuildActionEntry></BuildActionEntries>
  </BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
    <Testables><TestableReference skipped="NO"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('uitest-target')}" BuildableName="PassArchiveUITests.xctest" BlueprintName="PassArchiveUITests" ReferencedContainer="container:PassArchive.xcodeproj"/></TestableReference></Testables>
  </TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES">
    <BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="PassArchive.app" BlueprintName="PassArchive" ReferencedContainer="container:PassArchive.xcodeproj"/></BuildableProductRunnable>
  </LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="PassArchive.app" BlueprintName="PassArchive" ReferencedContainer="container:PassArchive.xcodeproj"/></BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print(project)
